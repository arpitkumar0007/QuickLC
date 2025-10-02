const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

require("dotenv").config();


const Template = require("./models/Template");

const app = express();
app.use(cors());
app.use(express.json());


// DB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error(err));


app.get("/templates", async (req, res) => {
  
  try {
    const templates = await Template.find().sort({ createdAt: -1 });
    res.json(templates);
  } 
  catch (error) {
    res.status(500).json({ error: error.message });
  }

});



app.post("/templates", async (req, res) => {

  try {
    const { name, code, language } = req.body; 
    
    if (!name || !code) {
      return res.status(400).json({ error: "Name and code required" });
    }

    const newTemplate = new Template({ 
      name, 
      code,
      language: language || 'cpp' 
    });
    
    await newTemplate.save();
    res.json(newTemplate);
  } 
  catch (error) {
    res.status(500).json({ error: error.message });
  }

});


app.delete("/templates/:id", async (req, res) => {

  try {
    const { id } = req.params;
    const deleted = await Template.findByIdAndDelete(id);
    
    if (!deleted) {
      return res.status(404).json({ error: "Template not found" });
    }
    
    res.json({ success: true, message: "Template deleted" });
  } 
  catch (error) {
    res.status(500).json({ error: error.message });
  }

});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));