// Henriks console.log
import console from "hvb-console";

import cors from "cors";

// ------------------- Custom middlewares -------------------
import { restrict, checkAuthorization } from "./middleware.js";

// ------------------- Setup user sessions -------------------
import cookieParser from "cookie-parser";
import session from "express-session";
import bcrypt from "bcrypt";
import MongoStore from "connect-mongo";

// ------------------- Setup express -------------------
import express from "express";
const app = express();
app.set("trust proxy", 1)
const PORT = process.env.PORT || 3000;
// For encryption of passwords
const SALT_ROUNDS = 10;

// ------------------- Setup .env & Mongo -------------------
import dotenv from "dotenv";
dotenv.config();
const MONGO_URI = process.env.MONGO_URI;
import { MongoClient, ObjectId } from "mongodb";
// ObjectId is needed for accessing specific documents in mongoDB by ID

// ------------------- Del expired booking interval -------------------
import { setInterval } from "node:timers";
import { deleteExpiredBookings } from "./helper.js";
// 1 hour in milliseconds
const DEL_INTERVAL = 60 * 60 * 1000; 

// ------------------- Connect to database -------------------
const client = new MongoClient(MONGO_URI);
const sessionStore = MongoStore.create({
    mongoUrl: MONGO_URI,
    dbName: "booking-system",
});
await client.connect();

// Define db and collections
const db = client.db("booking-system");

const bookingsCollection = db.collection("bookings");
const usersCollection = db.collection("users");

/* Store the bookingsCollection in app.locals,
which is an object provided by Express.js */
app.locals.bookingsCollection = bookingsCollection;

// ------------------- Middlewares -------------------
app.use(cookieParser());
app.use(express.json());
app.use(
    session({
        // don't save session if unmodified
        resave: false,
        // don't create session until something stored
        saveUninitialized: false, // GDPR - user has to give consent
        secret: "shhhh very secret string",
        store: sessionStore,
        proxy: true,
        cookie: {
            sameSite: "none",
            secure: process.env.NODE_ENV == "production",
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000, // Session duration in milliseconds (e.g., 24 hours)
        },
    })
);
// Use CORS middleware to allow cross-origin requests
app.use(
    cors({
        origin: [
            "https://laundry-room-booking-system-de2d4ba71aff.herokuapp.com",
            "http://127.0.0.1:5502",
            "http://localhost:5002",
            "https://express-booking-system-backend.herokuapp.com",
        ],
        methods: ["POST", "PUT", "GET", "OPTIONS", "HEAD", "DELETE"],
        credentials: true,
    })
);

// ------------------- Routes -------------------

//! Bookings
// Get all
app.get("/api/v.1/bookings", restrict, async (req, res) => {
    try {
        const bookings = await bookingsCollection.find().toArray();

        res.json({
            acknowledged: true,
            bookings,
        });
    } catch (error) {
        console.error(error);

        res.status(400).json({
            acknowledged: false,
            error: error.message,
        });
    }
});

// Get one
app.get("/api/v.1/bookings/:id", checkAuthorization, async (req, res) => {
    try {
        const booking = await bookingsCollection.findOne({
            _id: new ObjectId(req.params.id),
            user_id: req.session.userId,
        });

        res.json({
            acknowledged: true,
            booking,
        });
    } catch (error) {
        console.error(error);

        res.status(400).json({
            acknowledged: false,
            error: error.message,
        });
    }
});

// Add one
app.post("/api/v.1/bookings", restrict, async(req, res) => {
    console.log("inside post /bookings");

    try {
        const { date } = req.body;

        console.log("date inside post /bookings", date);

        const booking = {
            date,
            user_id: req.session.userId,
        };

        console.log("booking inside post /bookings", booking);

        await bookingsCollection.insertOne(booking);

        res.json({
            acknowledged: true,
            booking,
        });
    } catch (error) {
        console.error("error inside post /bookings", error);

        res.status(400).json({
            acknowledged: false,
            error: error.message,
        });
    }
});



// Delete one
app.delete("/api/v.1/bookings/:id", checkAuthorization, async (req, res) => {
    try {
        const id = req.params.id;

        const response = await bookingsCollection.deleteOne({
            _id: new ObjectId(id),
        });

        if (response.deletedCount === 0) {
            throw new Error("No account found with the provided ID");
        }

        res.json({
            acknowledged: true,
            message: `Account #${id} successfully deleted`,
        });
    } catch (error) {
        console.error(error);

        res.status(400).json({
            acknowledged: false,
            error: error.message,
        });
    }
});

//! Users

app.post("/api/v.1/user/login", async (req, res) => {
    try {
        const user = await usersCollection.findOne({
            email: req.body.loginEmail,
        });

        if (user) {
            const { user: email, _id, pass } = user;

            const match = await bcrypt.compare(req.body.loginPass, pass);
            if (match) {
                // Set the user as logged in under current session
                req.session.user = email;
                req.session.userId = _id;

                res.json({
                    acknowledged: true,
                    user,
                });
            } else {
                res.status(401).json({
                    acknowledged: false,
                    error: "Invalid username or password.",
                    customError: true,
                });
                return;
            }
        } else {
            res.status(401).json({
                acknowledged: false,
                error: "Invalid username or password.",
                customError: true,
            });
            return;
        }
    } catch (error) {
        console.error(error);

        res.status(401).json({
            acknowledged: false,
            error: error.message,
        });
    }
});

// Register user
app.post("/api/v.1/user/register", async (req, res) => {
    try {
        const takenEmail = await usersCollection.findOne({
            email: req.body.regEmail,
        });
        if (!takenEmail) {
            const hash = await bcrypt.hash(req.body.regPass, SALT_ROUNDS);

            const newUser = await usersCollection.insertOne({
                user: req.body.regName,
                email: req.body.regEmail,
                pass: hash,
            });
            if (newUser.acknowledged) {
                req.session.user = req.body.regName;
                req.session.userId = newUser.insertedId;
                res.json({
                    acknowledged: true,
                    user: req.body.regName,
                });
            }
        } else {
            res.status(400).json({
                acknowledged: false,
                error: "Email already exists",
                customError: true,
            });
            return;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({
            acknowledged: false,
            error: err.message,
        });
    }
});

// Get currently signed-in user's booking
app.get("/api/v.1/user/booking", async(req, res) => {
    try {
        const userId = req.session.userId;

        const booking = await bookingsCollection.findOne({ user_id: userId });

        res.json({
            acknowledged: true,
            booking,
        });
    } catch (err) {
        console.error(err);
        res.status(400).json({
            acknowledged: false,
            error: err.message,
        });
    }
})

// Get active user
app.get("/api/v.1/user/active", (req, res) => {
    if (req.session.user) {
        const userId = req.session.userId;
        res.json({
            acknowledged: true,
            user: req.session.user,
            userId: userId,
        });
    } else {
        res.status(401).json({
            acknowledged: false,
            error: "Unauthorized",
        });
    }
});

// Logout user
app.post("/api/v.1/user/logout", restrict, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.log(err);
            return res.sendStatus(500);
        }
        sessionStore.destroy(req.sessionID, (err) => {
            if (err) {
                console.log(err);
                return res.sendStatus(500);
            }
            res.clearCookie("connect.sid");
            res.json({
                loggedin: false,
            });
        });
    });
});

// ------------------- Schedule deleteExpiredBookings to run according to DEL_INTERVAL -------------------

setInterval(() => {
    deleteExpiredBookings(app);
}, DEL_INTERVAL);

// ------------------- Start the server -------------------
// Starting the server and listening for incoming http requests made to the specified port
app.listen(PORT, (err) => {
    if (err) {
        console.error("Error when listening: #", code, err);
        return;
    }
    console.log("Template is listening on port ", PORT);
});
