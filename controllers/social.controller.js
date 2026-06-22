/**
 * social.controller.js
 * Social Media Post Management — Facebook & Instagram
 * Multi-tenant: uses tenant's stored pageAccessToken from MetaIntegration
 */

import axios    from "axios";
import path     from "path";
import fs       from "fs";
import { getTenantModels } from "../models/tenant/index.js";

const GRAPH_API = "https://graph.facebook.com/v21.0";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Upload a photo to Facebook and return the media fbid (for carousel or direct post) */
const uploadPhotoToFacebook = async (pageId, pageToken, imageUrl, published = false) => {
  const { data } = await axios.post(`${GRAPH_API}/${pageId}/photos`, null, {
    params: { url: imageUrl, published, access_token: pageToken },
  });
  return data.id; // media fbid
};

/** Create Instagram media container and return container id */
const createInstagramContainer = async (igUserId, pageToken, params) => {
  const { data } = await axios.post(`${GRAPH_API}/${igUserId}/media`, null, {
    params: { ...params, access_token: pageToken },
  });
  return data.id;
};

/** Publish Instagram media container */
const publishInstagramContainer = async (igUserId, pageToken, containerId) => {
  const { data } = await axios.post(`${GRAPH_API}/${igUserId}/media_publish`, null, {
    params: { creation_id: containerId, access_token: pageToken },
  });
  return data.id;
};

// ─── Controllers ────────────────────────────────────────────────────────────

export default {

  /**
   * POST /:tenantSlug/api/social/posts
   * Create and publish (or schedule) a post
   * Body: { content, mediaUrls[], mediaType, postToFacebook, postToInstagram, scheduledAt? }
   */
  createPost: async (req, res) => {
    try {
      const { MetaIntegration, SocialPost } = getTenantModels(req.tenantDB);
      const {
        content        = "",
        mediaUrls      = [],
        mediaType      = "none",
        postToFacebook  = true,
        postToInstagram = false,
        scheduledAt,
      } = req.body;

      if (!content && mediaUrls.length === 0) {
        return res.status(400).json({ success: false, message: "Post must have text or media" });
      }

      // Get active integration
      const integration = await MetaIntegration.findOne({ status: "active" });
      if (!integration) {
        return res.status(400).json({ success: false, message: "No Facebook Page connected. Go to Integrations first." });
      }

      // Save post as draft first
      const post = await SocialPost.create({
        content,
        mediaUrls,
        mediaType,
        postToFacebook,
        postToInstagram,
        scheduledAt:    scheduledAt ? new Date(scheduledAt) : null,
        status:         scheduledAt ? "scheduled" : "draft",
        facebookPageId: integration.facebookPageId,
        pageName:       integration.pageName,
        createdBy:      req.user._id,
      });

      // If scheduled — don't publish now
      if (scheduledAt) {
        return res.json({ success: true, message: "Post scheduled successfully!", post });
      }

      // Publish now
      let fbPostId   = null;
      let igPostId   = null;
      const errors   = [];

      // ── Publish to Facebook ──────────────────────────────────────────────
      if (postToFacebook) {
        try {
          if (mediaType === "none" || mediaUrls.length === 0) {
            // Text-only post
            const { data } = await axios.post(`${GRAPH_API}/${integration.facebookPageId}/feed`, null, {
              params: { message: content, access_token: integration.pageAccessToken },
            });
            fbPostId = data.id;

          } else if (mediaType === "image" && mediaUrls.length === 1) {
            // Single image
            const { data } = await axios.post(`${GRAPH_API}/${integration.facebookPageId}/photos`, null, {
              params: { url: mediaUrls[0], caption: content, access_token: integration.pageAccessToken },
            });
            fbPostId = data.post_id || data.id;

          } else if (mediaType === "carousel" || mediaUrls.length > 1) {
            // Multi-image carousel — upload each as unpublished then attach to feed
            const mediaFbids = await Promise.all(
              mediaUrls.map(url => uploadPhotoToFacebook(integration.facebookPageId, integration.pageAccessToken, url, false))
            );
            const attachedMedia = mediaFbids.map(id => ({ media_fbid: id }));
            const { data } = await axios.post(`${GRAPH_API}/${integration.facebookPageId}/feed`, null, {
              params: {
                message:        content,
                attached_media: JSON.stringify(attachedMedia),
                access_token:   integration.pageAccessToken,
              },
            });
            fbPostId = data.id;

          } else if (mediaType === "video") {
            const { data } = await axios.post(`${GRAPH_API}/${integration.facebookPageId}/videos`, null, {
              params: { file_url: mediaUrls[0], description: content, access_token: integration.pageAccessToken },
            });
            fbPostId = data.id;
          }

          console.log(`✅ Facebook post published: ${fbPostId}`);
        } catch (fbErr) {
          const msg = fbErr.response?.data?.error?.message || fbErr.message;
          errors.push(`Facebook: ${msg}`);
          console.error("Facebook post error:", msg);
        }
      }

      // ── Publish to Instagram ─────────────────────────────────────────────
      if (postToInstagram && integration.instagramAccountId) {
        try {
          let containerId;

          if (mediaType === "none" || mediaUrls.length === 0) {
            return res.status(400).json({ success: false, message: "Instagram requires at least one image or video" });
          } else if (mediaType === "image" && mediaUrls.length === 1) {
            containerId = await createInstagramContainer(integration.instagramAccountId, integration.pageAccessToken, {
              image_url: mediaUrls[0],
              caption:   content,
              media_type: "IMAGE",
            });
          } else if (mediaType === "video") {
            containerId = await createInstagramContainer(integration.instagramAccountId, integration.pageAccessToken, {
              video_url:  mediaUrls[0],
              caption:    content,
              media_type: "REELS",
            });
          } else if (mediaType === "carousel" || mediaUrls.length > 1) {
            // Create individual containers for each image
            const childIds = await Promise.all(
              mediaUrls.map(url => createInstagramContainer(integration.instagramAccountId, integration.pageAccessToken, {
                image_url:   url,
                is_carousel_item: true,
              }))
            );
            // Create carousel container
            containerId = await createInstagramContainer(integration.instagramAccountId, integration.pageAccessToken, {
              media_type: "CAROUSEL",
              caption:    content,
              children:   childIds.join(","),
            });
          }

          igPostId = await publishInstagramContainer(integration.instagramAccountId, integration.pageAccessToken, containerId);
          console.log(`✅ Instagram post published: ${igPostId}`);
        } catch (igErr) {
          const msg = igErr.response?.data?.error?.message || igErr.message;
          errors.push(`Instagram: ${msg}`);
          console.error("Instagram post error:", msg);
        }
      } else if (postToInstagram && !integration.instagramAccountId) {
        errors.push("Instagram: No Instagram account linked to this page");
      }

      // Update post record
      const finalStatus = errors.length === 2 ? "failed"
        : (fbPostId || igPostId) ? "published" : "failed";

      await SocialPost.findByIdAndUpdate(post._id, {
        status:         finalStatus,
        facebookPostId: fbPostId,
        instagramPostId: igPostId,
        publishedAt:    finalStatus === "published" ? new Date() : null,
        errorMessage:   errors.length ? errors.join(" | ") : null,
      });

      const updatedPost = await SocialPost.findById(post._id);
      res.json({
        success: true,
        message: finalStatus === "published" ? "Post published successfully!" : "Post published with some errors",
        post:    updatedPost,
        errors:  errors.length ? errors : undefined,
      });

    } catch (err) {
      console.error("createPost error:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /:tenantSlug/api/social/posts
   * List all posts for this tenant (paginated)
   */
  getPosts: async (req, res) => {
    try {
      const { SocialPost } = getTenantModels(req.tenantDB);
      const page  = parseInt(req.query.page)   || 1;
      const limit = parseInt(req.query.limit)  || 10;
      const status = req.query.status || null;

      const query = status ? { status } : {};
      const total = await SocialPost.countDocuments(query);
      const posts = await SocialPost.find(query)
        .populate("createdBy", "firstName lastName email profileImage")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      res.json({ success: true, data: posts, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
      console.error("getPosts error:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * DELETE /:tenantSlug/api/social/posts/:id
   * Delete a post (from CRM only — does NOT delete from Facebook/Instagram)
   */
  deletePost: async (req, res) => {
    try {
      const { SocialPost } = getTenantModels(req.tenantDB);
      await SocialPost.findByIdAndDelete(req.params.id);
      res.json({ success: true, message: "Post deleted" });
    } catch (err) {
      console.error("deletePost error:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /:tenantSlug/api/social/page-insights
   * Fetch page-level insights (followers, reach, impressions)
   */
  getPageInsights: async (req, res) => {
    try {
      const { MetaIntegration } = getTenantModels(req.tenantDB);
      const integration = await MetaIntegration.findOne({ status: "active" });
      if (!integration) return res.status(400).json({ success: false, message: "No Facebook Page connected" });

      const metrics = [
        "page_fans",
        "page_impressions",
        "page_reach",
        "page_post_engagements",
        "page_views_total",
      ].join(",");

      const { data } = await axios.get(`${GRAPH_API}/${integration.facebookPageId}/insights`, {
        params: {
          metric:       metrics,
          period:       "day",
          access_token: integration.pageAccessToken,
        },
      });

      res.json({ success: true, data: data.data, pageName: integration.pageName });
    } catch (err) {
      console.error("getPageInsights error:", err.response?.data || err.message);
      res.status(500).json({ success: false, message: err.response?.data?.error?.message || err.message });
    }
  },
};
