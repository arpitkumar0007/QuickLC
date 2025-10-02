const mongoose = require("mongoose");

const TemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true
  },
  language: {
    type: String,
    default: 'cpp',
    enum: ['cpp', 'python', 'java', 'javascript', 'typescript', 'go', 'rust']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Template", TemplateSchema);