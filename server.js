const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;
const JWT_SECRET = "your_jwt_secret"; // Replace with a secure secret

const fs = require('fs');

// Enable CORS for the frontend with enhanced configuration
app.use(cors({
    origin: 'https://hotel-frontend-r9xx.onrender.com', // Exact frontend origin
    credentials: true, // Allow credentials (cookies)
    methods: ['GET', 'POST', 'OPTIONS'], // Allow these methods
    allowedHeaders: ['Content-Type', 'Authorization'] // Allow these headers
}));

// Middleware to parse JSON requests
app.use(express.json());

// Initialize the database
const dbPath = './hotel.db';
let dbExists = fs.existsSync(dbPath);
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err);
        return;
    }
    console.log('Connected to SQLite database');
});

// Create tables and seed data if the database is newly created
db.serialize(() => {
    // Create Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    `);

    // Create Rooms table
    db.run(`
        CREATE TABLE IF NOT EXISTS Rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hotel_name TEXT NOT NULL,
            location TEXT NOT NULL,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            available INTEGER NOT NULL,
            image TEXT NOT NULL,
            amenities TEXT NOT NULL
        )
    `);

    // Create Bookings table
    db.run(`
        CREATE TABLE IF NOT EXISTS Bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            room_id INTEGER NOT NULL,
            check_in TEXT NOT NULL,
            check_out TEXT NOT NULL,
            booking_date TEXT NOT NULL,
            room_count INTEGER NOT NULL,
            total_price REAL NOT NULL,
            FOREIGN KEY (user_id) REFERENCES Users(id),
            FOREIGN KEY (room_id) REFERENCES Rooms(id)
        )
    `);

    // Seed data if the database was just created
    if (!dbExists) {
        console.log('Database created, seeding initial data...');

        // Seed default user (test@example.com / password123)
        console.log('Seeding default user...');
        const saltRounds = 10;
        bcrypt.hash('password123', saltRounds, (err, hash) => {
            if (err) {
                console.error('Error hashing password for default user:', err.message);
                return;
            }
            const defaultUserStmt = db.prepare('INSERT INTO Users (email, password) VALUES (?, ?)');
            defaultUserStmt.run('test@example.com', hash, (err) => {
                if (err) {
                    console.error('Error inserting default user:', err.message);
                } else {
                    console.log('Default user seeded: test@example.com');
                }
            });
            defaultUserStmt.finalize();
        });

        // Seed rooms from rooms.json
        if (fs.existsSync('./rooms.json')) {
            const roomsData = JSON.parse(fs.readFileSync('./rooms.json'));
            console.log(`Attempting to seed ${roomsData.length} rooms from rooms.json`);
            const roomStmt = db.prepare('INSERT INTO Rooms (hotel_name, location, name, price, available, image, amenities) VALUES (?, ?, ?, ?, ?, ?, ?)');
            let insertedRooms = 0;
            roomsData.forEach((room, index) => {
                // Validate required fields
                if (!room.hotel_name || room.hotel_name === '') {
                    console.error(`Error: Room at index ${index} is missing hotel_name`);
                    return;
                }
                if (!room.location || room.location === '') {
                    console.error(`Error: Room at index ${index} is missing location`);
                    return;
                }
                if (!room.name || room.name === '') {
                    console.error(`Error: Room at index ${index} is missing name`);
                    return;
                }
                if (room.price == null) {
                    console.error(`Error: Room at index ${index} is missing price`);
                    return;
                }
                if (room.available == null) {
                    console.error(`Error: Room at index ${index} is missing available`);
                    return;
                }
                if (!room.image || room.image === '') {
                    console.error(`Error: Room at index ${index} is missing image`);
                    return;
                }
                if (!room.amenities) {
                    console.warn(`Warning: Room at index ${index} is missing amenities, defaulting to empty array`);
                    room.amenities = [];
                }

                try {
                    roomStmt.run(
                        room.hotel_name,
                        room.location,
                        room.name,
                        room.price,
                        room.available,
                        room.image,
                        JSON.stringify(room.amenities)
                    );
                    insertedRooms++;
                    console.log(`Inserted room ${index + 1}: ${room.hotel_name} - ${room.name} (${room.location})`);
                } catch (err) {
                    console.error(`Error inserting room at index ${index}:`, err.message);
                }
            });
            roomStmt.finalize((err) => {
                if (err) {
                    console.error('Error finalizing room statement:', err.message);
                } else {
                    console.log(`Successfully seeded ${insertedRooms} rooms from rooms.json`);
                }
            });
        } else {
            console.warn('rooms.json not found, Rooms table will be empty');
        }
    }
});

// Routes
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
                "INSERT INTO bookings (user_id, room_id, check_in, check_out, booking_date, room_count, total_price) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
             JOIN rooms ON bookings.room_id = rooms.id
             WHERE bookings.user_id = ?
             ORDER BY bookings.booking_date DESC`,
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