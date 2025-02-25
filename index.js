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
mongoose
  .connect(process.env.MONGODB_URL)
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
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
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
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

// Routes

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

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashPass = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashPass });
    await newUser.save();
    
    res.status(201).json({ message: "Registration successful" });
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

    const token = jwt.sign({ userId: foundUser._id }, process.env.JWT_SECRET, { expiresIn: "24h" });

    res.json({ message: "Login successful", token, user: foundUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error logging in" });
  }
});

// Fetch recipes from Spoonacular API
app.get("/recipes", async (req, res) => {
  try {
    const { query, number = 10, offset = 0 } = req.query;

    const params = {
      apiKey: process.env.SPOONACULAR_API_KEY,
      number,
      offset,
    };
    if (query && query.trim() !== "") {
      params.query = query;
    }

    const response = await axios.get("https://api.spoonacular.com/recipes/complexSearch", { params });

    res.json(response.data.results);
  } catch (err) {
    console.error("Error fetching recipes:", err.response?.data || err.message);
    res.status(500).json({ message: "Failed to fetch recipes. Try again later." });
  }
});


// Save a recipe
app.post("/recipes/save", authMiddleware, async (req, res) => {
  try {
    const { recipeId, title, image, category } = req.body;
    const userId = req.userId;

    const savedRecipe = new SavedRecipe({ userId, recipeId, title, image, category });
    await savedRecipe.save();

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
    const recipes = await SavedRecipe.find({ userId });
    res.json(recipes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching saved recipes" });
  }
});

// Reorder saved recipes
app.put("/recipes/reorder", authMiddleware, async (req, res) => {
  try {
    const { recipes } = req.body;
    for (let i = 0; i < recipes.length; i++) {
      await SavedRecipe.findByIdAndUpdate(recipes[i], { position: i });
    }
    res.json({ message: "Recipes reordered successfully" });
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

    const recipe = await SavedRecipe.findOneAndDelete({ _id: recipeId, userId });
    if (!recipe) {
      return res.status(404).json({ message: "Recipe not found or already deleted" });
    }

    await User.findByIdAndUpdate(userId, { $pull: { savedRecipes: recipeId } });

    res.json({ message: "Recipe removed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error removing recipe" });
  }
});



// Fetch full recipe details by ID
app.get("/recipes_detail/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const response = await axios.get(
      `https://api.spoonacular.com/recipes/${id}/information?apiKey=${API_KEY}`
    );
    res.json(response.data); // Send full recipe details
  } catch (error) {
    console.error("Error fetching recipe:", error.message);
    res.status(500).json({ error: "Failed to fetch recipe details" });
  }
});

// Search recipes
app.get("/recipes/search", async (req, res) => {
  try {
    const { query } = req.query;
    const response = await axios.get(
      "https://api.spoonacular.com/recipes/complexSearch",
      {
        params: {
          apiKey: process.env.SPOONACULAR_API_KEY,
          query: query,
          number: 10, // Number of results to return
        },
      }
    );
    res.json(response.data.results);
  } catch (err) {
    console.error("Error searching recipes:", err.response?.data || err.message);
    res.status(500).json({ message: "Failed to search recipes. Try again later." });
  }
});


// Start the server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));







