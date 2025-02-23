const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");

// Import models
const User = require("./models/user.model");
const SavedRecipe = require("./models/Recipe.model");

dotenv.config();

const app = express();
app.use(express.json());

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    console.log("MongoDB connected");
  } catch (error) {
    console.log("Error connecting to MongoDB", error);
    process.exit(1); // Exit the process if MongoDB connection fails
  }
};

// Start the server
app.listen(8000, () => {
  console.log("Server is running on port 8000");
  connectDB();
});

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

// Get all users
app.get("/api/users", authMiddleware, async (req, res) => {
  try {
    // Fetch all users from the database
    const users = await User.find({}, { password: 0 }); // Exclude the password field for security

    res.status(200).json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching users" });
  }
});

// Default route
app.get("/", (req, res) => {
  res.send("Recipe App Backend");
});

// User registration
app.post("/api/auth/register", async (req, res) => {
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
app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      console.log("Login request:", { email, password });
  
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
  
      const foundUser = await User.findOne({ email });
      console.log("Found user:", foundUser);
  
      if (!foundUser) {
        return res.status(404).json({ message: "User not found" });
      }
  
      const isPasswordValid = await bcrypt.compare(password, foundUser.password);
      console.log("Is password valid:", isPasswordValid);
  
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid password" });
      }
  
      // Check if JWT_SECRET is defined
      if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is not defined");
        return res.status(500).json({ message: "Server configuration error" });
      }
  
      // Generate JWT token
      const token = jwt.sign({ userId: foundUser._id }, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });
  
      res.json({ message: "Login successful", token });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ message: "Error logging in" });
    }
  });

// Fetch recipes from Spoonacular API
app.get("/api/recipes/search", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ message: "Query parameter is required" });
    }

    const response = await axios.get(
      `https://api.spoonacular.com/recipes/complexSearch`,
      {
        params: {
          apiKey: process.env.SPOONACULAR_API_KEY,
          query: query,
          number: 10, // Number of recipes to fetch
        },
      }
    );

    res.json(response.data.results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching recipes" });
  }
});

// Save a recipe
app.post("/api/recipes/save", authMiddleware, async (req, res) => {
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
app.get("/api/recipes/saved", authMiddleware, async (req, res) => {
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
app.put("/api/recipes/reorder", authMiddleware, async (req, res) => {
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
app.delete("/api/recipes/:id", authMiddleware, async (req, res) => {
  try {
    const recipeId = req.params.id;
    const userId = req.userId;

    // Remove the recipe from the SavedRecipe collection
    await SavedRecipe.findByIdAndDelete(recipeId);

    // Remove the recipe reference from the user's savedRecipes array
    await User.findByIdAndUpdate(userId, { $pull: { savedRecipes: recipeId } });

    res.json({ message: "Recipe removed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error removing recipe" });
  }
});