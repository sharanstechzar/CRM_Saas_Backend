import cron from "node-cron";
import axios from "axios";
import mongoose from "mongoose";
import Tenant from "../models/master/Tenant.js";
import { getTenantDB } from "../config/tenantDB.js";
import { getTenantModels } from "../models/tenant/index.js";

const GRAPH_API = "https://graph.facebook.com/v21.0";

const uploadPhotoToFacebook = async (pageId, token, imageUrl) => {
  const { data } = await axios.post(`${GRAPH_API}/${pageId}/photos`, null, {
    params: { url: imageUrl, published: false, access_token: token },
  });
  return data.id;
};

const createIgContainer = async (igId, token, params) => {
  const { data } = await axios.post(`${GRAPH_API}/${igId}/media`, null, {
    params: { ...params, access_token: token },
  });
  return data.id;
};

const publishIgContainer = async (igId, token, containerId) => {
  const { data } = await axios.post(`${GRAPH_API}/${igId}/media_publish`, null, {
    params: { creation_id: containerId, access_token: token },
  });
  return data.id;
};

const publishPost = async (post, integration) => {
  let fbPostId = null;
  let igPostId = null;
  const errors = [];

  if (post.postToFacebook) {
    try {
      const { facebookPageId: pageId, pageAccessToken: token } = integration;
      if (post.mediaType === "none" || post.mediaUrls.length === 0) {
        const { data } = await axios.post(`${GRAPH_API}/${pageId}/feed`, null, {
          params: { message: post.content, access_token: token },
        });
        fbPostId = data.id;
      } else if (post.mediaType === "image" && post.mediaUrls.length === 1) {
        const { data } = await axios.post(`${GRAPH_API}/${pageId}/photos`, null, {
          params: { url: post.mediaUrls[0], caption: post.content, access_token: token },
        });
        fbPostId = data.post_id || data.id;
      } else if (post.mediaUrls.length > 1) {
        const ids = await Promise.all(post.mediaUrls.map(u => uploadPhotoToFacebook(pageId, token, u)));
        const { data } = await axios.post(`${GRAPH_API}/${pageId}/feed`, null, {
          params: {
            message: post.content,
            attached_media: JSON.stringify(ids.map(id => ({ media_fbid: id }))),
            access_token: token,
          },
        });
        fbPostId = data.id;
      } else if (post.mediaType === "video") {
        const { data } = await axios.post(`${GRAPH_API}/${pageId}/videos`, null, {
          params: { file_url: post.mediaUrls[0], description: post.content, access_token: token },
        });
        fbPostId = data.id;
      }
    } catch (err) {
      errors.push(`Facebook: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  if (post.postToInstagram && integration.instagramAccountId) {
    try {
      const { instagramAccountId: igId, pageAccessToken: token } = integration;
      let containerId;
      if (post.mediaType === "image" && post.mediaUrls.length === 1) {
        containerId = await createIgContainer(igId, token, { image_url: post.mediaUrls[0], caption: post.content, media_type: "IMAGE" });
      } else if (post.mediaType === "video") {
        containerId = await createIgContainer(igId, token, { video_url: post.mediaUrls[0], caption: post.content, media_type: "REELS" });
      } else if (post.mediaUrls.length > 1) {
        const childIds = await Promise.all(post.mediaUrls.map(u => createIgContainer(igId, token, { image_url: u, is_carousel_item: true })));
        containerId = await createIgContainer(igId, token, { media_type: "CAROUSEL", caption: post.content, children: childIds.join(",") });
      }
      if (containerId) igPostId = await publishIgContainer(igId, token, containerId);
    } catch (err) {
      errors.push(`Instagram: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  return { fbPostId, igPostId, errors };
};

// Runs every minute — publish any scheduled posts whose time has come
cron.schedule("* * * * *", async () => {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const tenants = await Tenant.find({ isActive: true }).lean();
    const now = new Date();

    for (const tenant of tenants) {
      try {
        const conn = await getTenantDB(tenant.dbName);
        const { SocialPost, MetaIntegration } = getTenantModels(conn);

        const duePosts = await SocialPost.find({
          status: "scheduled",
          scheduledAt: { $lte: now },
        });

        if (!duePosts.length) continue;

        const integration = await MetaIntegration.findOne({ status: "active" });
        if (!integration) continue;

        for (const post of duePosts) {
          const { fbPostId, igPostId, errors } = await publishPost(post, integration);
          const finalStatus = (fbPostId || igPostId) ? "published" : "failed";
          await SocialPost.findByIdAndUpdate(post._id, {
            status:          finalStatus,
            facebookPostId:  fbPostId,
            instagramPostId: igPostId,
            publishedAt:     finalStatus === "published" ? new Date() : null,
            errorMessage:    errors.length ? errors.join(" | ") : null,
          });
          console.log(`[SocialCron] ${tenant.slug} | Post ${post._id} → ${finalStatus}`);
        }
      } catch (tenantErr) {
        console.error(`[SocialCron] Error for tenant ${tenant.slug}:`, tenantErr.message);
      }
    }
  } catch (err) {
    console.error("[SocialCron] Fatal error:", err.message);
  }
});
