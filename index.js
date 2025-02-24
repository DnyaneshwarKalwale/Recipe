const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");

dotenv.config();

const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URL)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("Error connecting to MongoDB:", err));

// Models
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  savedRecipes: [{ type: mongoose.Schema.Types.ObjectId, ref: "SavedRecipe" }],
});

const savedRecipeSchema = new mongoose.Schema({
  recipeId: { type: String, required: true },
  title: { type: String, required: true },
  image: { type: String, required: true },
  category: { type: String, enum: ["breakfast", "lunch", "dinner"], required: true },
  position: { type: Number, default: 0 },
});

const User = mongoose.model("User", userSchema);
const SavedRecipe = mongoose.model("SavedRecipe", savedRecipeSchema);

// Middleware for authentication
const authMiddleware = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(400).json({ message: "Invalid token" });
  }
};

// Routes

// Default route
app.get("/", (req, res) => {
  res.send("Recipe App Backend");
});

// User registration
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const hashPass = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashPass });
    const savedUser = await newUser.save();
    res.status(201).json({ message: "Registration Successful", savedUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error registering user" });
  }
});

// User login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const foundUser = await User.findOne({ email });
    if (!foundUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const isPasswordValid = await bcrypt.compare(password, foundUser.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid password" });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: foundUser._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    res.json({ message: "Login successful", token, user: foundUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error logging in" });
  }
});

// Fetch recipes from Spoonacular API
app.get("/recipes", async (req, res) => {
  try {
    const { query, number, offset } = req.query;

    // Validate query parameters
    if (!query || !number || !offset) {
      return res.status(400).json({ message: "Query, number, and offset are required" });
    }

    // Construct the Spoonacular API URL with query parameters
    const apiUrl = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${process.env.SPOONACULAR_API_KEY}&query=${encodeURIComponent(query)}&number=${number}&offset=${offset}`;

    // Call Spoonacular API
    const response = await axios.get(apiUrl);

    res.json(response.data.results);
  } catch (err) {
    console.error("Error fetching recipes:", err);
    res.status(500).json({ message: "Error fetching recipes" });
  }
});

// Save a recipe
app.post("/recipes/save", authMiddleware, async (req, res) => {
  try {
    const { recipeId, title, image, category } = req.body;
    const userId = req.userId; // From authMiddleware

    const savedRecipe = new SavedRecipe({ recipeId, title, image, category });
    await savedRecipe.save();

    // Add the saved recipe to the user's savedRecipes array
    await User.findByIdAndUpdate(userId, { $push: { savedRecipes: savedRecipe._id } });

    res.status(201).json({ message: "Recipe saved successfully", savedRecipe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error saving recipe" });
  }
});

// Get saved recipes
app.get("/recipes/saved", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId).populate("savedRecipes");
    res.json(user.savedRecipes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching saved recipes" });
  }
});

// Reorder saved recipes
app.put("/recipes/reorder", authMiddleware, async (req, res) => {
  try {
    const { recipes } = req.body; // Array of recipe IDs in new order
    const userId = req.userId;

    // Update the position of each recipe
    for (let i = 0; i < recipes.length; i++) {
      await SavedRecipe.findByIdAndUpdate(recipes[i], { position: i });
    }

    res.status(200).json({ message: "Recipes reordered successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error reordering recipes" });
  }
});

// Remove a saved recipe
app.delete("/recipes/:id", authMiddleware, async (req, res) => {
  try {
    const recipeId = req.params.id;
    const userId = req.userId;

    await SavedRecipe.findByIdAndDelete(recipeId);

    await User.findByIdAndUpdate(userId, { $pull: { savedRecipes: recipeId } });

    res.json({ message: "Recipe removed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error removing recipe" });
  }
});

// Start the server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});