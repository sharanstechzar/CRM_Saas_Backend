import mongoose from "mongoose";

const socialPostSchema = new mongoose.Schema({
  content:      { type: String, default: "" },
  mediaUrls:    [{ type: String }],            // uploaded image/video URLs
  mediaType:    { type: String, enum: ["none", "image", "video", "carousel"], default: "none" },

  // Target platforms
  postToFacebook:  { type: Boolean, default: true },
  postToInstagram: { type: Boolean, default: false },

  // Scheduling
  status:       { type: String, enum: ["draft", "scheduled", "published", "failed"], default: "draft" },
  scheduledAt:  { type: Date, default: null },
  publishedAt:  { type: Date, default: null },

  // Meta API response IDs (stored after publishing)
  facebookPostId:  { type: String, default: null },
  instagramPostId: { type: String, default: null },

  // Which page was used
  facebookPageId:  { type: String, default: null },
  pageName:        { type: String, default: "" },

  // Error tracking
  errorMessage: { type: String, default: null },

  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

export default socialPostSchema;
