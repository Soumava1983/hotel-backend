require('dotenv').config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://jdsziypwwtysgwvabsyp.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const PORT = 3000;
const JWT_SECRET = "your_jwt_secret";

const fs = require('fs');

app.use(cors({
    origin: 'https://hotel-frontend-r9xx.onrender.com',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const dbPath = './hotel.db';
let dbExists = fs.existsSync(dbPath);
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err);
        return;
    }
    console.log('Connected to SQLite database');
});

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    `);

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

    if (!dbExists) {
        console.log('Database created, seeding initial data...');

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

        if (fs.existsSync('./rooms.json')) {
            const roomsData = JSON.parse(fs.readFileSync('./rooms.json'));
            console.log(`Attempting to seed ${roomsData.length} rooms from rooms.json`);
            const roomStmt = db.prepare('INSERT INTO Rooms (hotel_name, location, name, price, available, image, amenities) VALUES (?, ?, ?, ?, ?, ?, ?)');
            let insertedRooms = 0;
            roomsData.forEach((room, index) => {
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

app.get('/rooms', async (req, res) => {
    try {
        const { location } = req.query;
        console.log(`Received request to fetch rooms with location: ${location || 'all'}`);
        let query = supabase.from('rooms').select('*');
        if (location) {
            console.log(`Applying location filter: ${location}`);
            query = query.ilike('location', location);
        }
        const { data, error } = await query;
        if (error) {
            console.error("Error fetching rooms from Supabase:", error.message, error.details);
            return res.status(500).json({ error: error.message });
        }

        // Transform Google Drive image URLs to direct links
        const transformedData = data.map(room => {
            let imageUrl = room.image;
            // Check if the URL is a Google Drive link
            const match = imageUrl.match(/\/file\/d\/(.+?)\/view/);
            if (match && match[1]) {
                imageUrl = `https://drive.google.com/uc?export=view&id=${match[1]}`;
            }
            return {
                ...room,
                image: imageUrl
            };
        });

        console.log(`Rooms fetched from Supabase: ${transformedData.length} rooms found`, JSON.stringify(transformedData, null, 2));
        res.json(transformedData);
    } catch (err) {
        console.error("Unexpected error fetching rooms:", err.message, err.stack);
        res.status(500).json({ error: "Internal server error" });
    }
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