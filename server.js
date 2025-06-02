const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;
const JWT_SECRET = "your_jwt_secret"; // Replace with a secure secret

// SQLite database setup
const db = new sqlite3.Database("./hotel.db", (err) => {
    if (err) {
        console.error("Error connecting to SQLite database:", err.message);
    } else {
        console.log("Connected to SQLite database");
    }
});

// CORS configuration
app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests from any origin (for testing)
            // In production, you should specify allowed origins explicitly
            callback(null, origin || "*");
        },
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true // Allow credentials (cookies, authorization headers, etc.)
    })
);

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files (images)
app.use(express.static(path.join(__dirname, "public")));

// Create tables if they don't exist
db.serialize(() => {
    db.run(
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`,
        (err) => {
            if (err) console.error("Error creating users table:", err.message);
            else console.log("Users table created or already exists");
        }
    );

    db.run(
        `CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hotel_name TEXT NOT NULL,
            location TEXT NOT NULL,
            name TEXT NOT NULL,
            price INTEGER NOT NULL,
            available INTEGER NOT NULL,
            image TEXT NOT NULL,
            amenities TEXT NOT NULL
        )`,
        (err) => {
            if (err) console.error("Error creating rooms table:", err.message);
            else console.log("Rooms table created or already exists");
        }
    );

    db.run(
        `CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            roomId INTEGER NOT NULL,
            checkIn TEXT NOT NULL,
            checkOut TEXT NOT NULL,
            bookingDate TEXT NOT NULL,
            roomCount INTEGER NOT NULL,
            total INTEGER NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id),
            FOREIGN KEY (roomId) REFERENCES rooms(id)
        )`,
        (err) => {
            if (err) console.error("Error creating bookings table:", err.message);
            else console.log("Bookings table created or already exists");
        }
    );

    // Seed rooms if the table is empty
    db.get("SELECT COUNT(*) as count FROM rooms", (err, row) => {
        if (err) {
            console.error("Error checking rooms table:", err.message);
            return;
        }
        if (row.count === 0) {
            const rooms = [
                // Your room data here (same as before)
                { hotel_name: "Hotel Sea View", location: "Puri", name: "Standard Room", price: 1500, available: 5, image: "/images/Puri/Hotel Sea View/room_standard.jpg", amenities: JSON.stringify(["Wi-Fi", "TV", "AC"]) },
                // ... other rooms ...
            ];
            const stmt = db.prepare("INSERT INTO rooms (hotel_name, location, name, price, available, image, amenities) VALUES (?, ?, ?, ?, ?, ?, ?)");
            rooms.forEach((room) => {
                stmt.run(room.hotel_name, room.location, room.name, room.price, room.available, room.image, room.amenities);
            });
            stmt.finalize();
            console.log("Rooms seeded");
        } else {
            console.log("Rooms table already has data, skipping seeding");
        }
    });

    // Seed a default user if not exists
    const defaultEmail = "test@example.com";
    const defaultPassword = "password123";
    bcrypt.hash(defaultPassword, 10, (err, hash) => {
        if (err) {
            console.error("Error hashing default password:", err.message);
            return;
        }
        db.run(
            "INSERT OR IGNORE INTO users (email, password) VALUES (?, ?)",
            [defaultEmail, hash],
            (err) => {
                if (err) console.error("Error seeding default user:", err.message);
                else console.log("Default user seeded: test@example.com");
            }
        );
    });
});

// Routes (same as before)
app.get("/check-session", (req, res) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token || token === "null") {
        console.log("No token provided, user not logged in");
        return res.json({ loggedIn: false });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log("Invalid or expired token, user not logged in");
            return res.json({ loggedIn: false });
        }
        console.log(`Session active for user ID: ${decoded.userId}`);
        res.json({ loggedIn: true });
    });
});

app.post("/login", (req, res) => {
    const { email, password } = req.body;
    console.log(`Login attempt for email: ${email}`);

    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err) {
            console.error("Error fetching user:", err.message);
            return res.status(500).json({ error: "Internal server error" });
        }
        if (!user) {
            console.log("User not found");
            return res.status(401).json({ error: "Invalid email or password" });
        }

        bcrypt.compare(password, user.password, (err, match) => {
            if (err) {
                console.error("Error comparing passwords:", err.message);
                return res.status(500).json({ error: "Internal server error" });
            }
            if (!match) {
                console.log("Password does not match");
                return res.status(401).json({ error: "Invalid email or password" });
            }

            const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1h" });
            console.log(`User logged in: ${email}, User ID: ${user.id}, Token issued`);
            res.json({ token });
        });
    });
});

app.get("/rooms", (req, res) => {
    const location = req.query.location || "all";
    console.log(`Fetching rooms for location: ${location}`);

    let query, params;
    if (location === "all") {
        query = "SELECT * FROM rooms";
        params = [];
    } else {
        query = "SELECT * FROM rooms WHERE LOWER(location) = LOWER(?)";
        params = [location];
    }

    db.all(query, params, (err, rooms) => {
        if (err) {
            console.error("Error fetching rooms:", err.message);
            return res.status(500).json({ error: "Internal server error" });
        }
        // Parse the amenities field for each room
        const parsedRooms = rooms.map(room => ({
            ...room,
            amenities: JSON.parse(room.amenities)
        }));
        console.log(`Rooms fetched: ${parsedRooms.length} rooms found`, parsedRooms);
        res.json(parsedRooms);
    });
});
app.post("/book", (req, res) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        console.log("No token provided for booking");
        return res.status(401).json({ error: "Unauthorized" });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log("Invalid or expired token for booking");
            return res.status(401).json({ error: "Unauthorized" });
        }

        console.log(`Token verified, User ID: ${decoded.userId}`);
        const { roomId, checkIn, checkOut, roomCount } = req.body;
        console.log(`Booking attempt, User ID: ${decoded.userId}`);
        console.log(`Booking request: Room ID ${roomId}, Check-In: ${checkIn}, Check-Out: ${checkOut}, Room Count: ${roomCount}, User ID: ${decoded.userId}`);

        db.get("SELECT * FROM rooms WHERE id = ?", [roomId], (err, room) => {
            if (err) {
                console.error("Error fetching room:", err.message);
                return res.status(500).json({ error: "Internal server error" });
            }
            if (!room) {
                console.log("Room not found");
                return res.status(404).json({ error: "Room not found" });
            }
            if (room.available < roomCount) {
                console.log("Not enough rooms available");
                return res.status(400).json({ error: "Not enough rooms available" });
            }

            const total = room.price * roomCount;
            const bookingDate = new Date().toISOString();

            db.run(
                "INSERT INTO bookings (userId, roomId, checkIn, checkOut, bookingDate, roomCount, total) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [decoded.userId, roomId, checkIn, checkOut, bookingDate, roomCount, total],
                function (err) {
                    if (err) {
                        console.error("Error creating booking:", err.message);
                        return res.status(500).json({ error: "Internal server error" });
                    }

                    db.run(
                        "UPDATE rooms SET available = available - ? WHERE id = ?",
                        [roomCount, roomId],
                        (err) => {
                            if (err) {
                                console.error("Error updating room availability:", err.message);
                                return res.status(500).json({ error: "Internal server error" });
                            }
                            console.log(`Booking created: Room ID ${roomId}, Room Count: ${roomCount}, Total: ₹${total}, User ID: ${decoded.userId}`);
                            res.json({ message: "Booking successful", total });
                        }
                    );
                }
            );
        });
    });
});

app.get("/bookings", (req, res) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        console.log("No token provided for fetching bookings");
        return res.status(401).json({ error: "Unauthorized" });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log("Invalid or expired token for fetching bookings");
            return res.status(401).json({ error: "Unauthorized" });
        }

        console.log(`Token verified, User ID: ${decoded.userId}`);
        console.log(`Fetching bookings for user ID: ${decoded.userId}`);

        db.all(
            `SELECT bookings.*, rooms.hotel_name, rooms.location, rooms.name, rooms.amenities
             FROM bookings
             JOIN rooms ON bookings.roomId = rooms.id
             WHERE bookings.userId = ?
             ORDER BY bookings.bookingDate DESC`,
            [decoded.userId],
            (err, bookings) => {
                if (err) {
                    console.error("Error fetching bookings:", err.message);
                    return res.status(500).json({ error: "Internal server error" });
                }
                // Parse the amenities field for each booking
                const parsedBookings = bookings.map(booking => ({
                    ...booking,
                    amenities: JSON.parse(booking.amenities)
                }));
                console.log("Bookings fetched:", parsedBookings);
                res.json(parsedBookings);
            }
        );
    });
});
app.post("/logout", (req, res) => {
    console.log("Logout request received");
    res.json({ message: "Logged out successfully" });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});