const mongoose = require("mongoose");

const savedRecipeSchema = new mongoose.Schema({
  recipeId: { type: String, required: true },
  title: { type: String, required: true },
  image: { type: String, required: true },
  category: { type: String, enum: ["breakfast", "lunch", "dinner"], required: true },
  position: { type: Number, default: 0 },
});

module.exports = mongoose.model("SavedRecipe", savedRecipeSchema);