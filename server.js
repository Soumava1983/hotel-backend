require('dotenv').config();
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://jdsziypwwtysgwvabsyp.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const PORT = 3000;
const JWT_SECRET = "your_jwt_secret";

app.use(cors({
    origin: 'https://hotel-frontend-r9xx.onrender.com',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

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

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    console.log(`Login attempt for email: ${email}`);

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            console.log("User not found");
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            console.log("Password does not match");
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1h" });
        console.log(`User logged in: ${email}, User ID: ${user.id}, Token issued`);
        res.json({ token });
    } catch (err) {
        console.error("Error during login:", err.message);
        res.status(500).json({ error: "Internal server error" });
    }
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
        console.log(`Rooms fetched from Supabase: ${data.length} rooms found`, JSON.stringify(data, null, 2));
        res.json(data);
    } catch (err) {
        console.error("Unexpected error fetching rooms:", err.message, err.stack);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/book", async (req, res) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        console.log("No token provided for booking");
        return res.status(401).json({ error: "Unauthorized" });
    }

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) {
            console.log("Invalid or expired token for booking");
            return res.status(401).json({ error: "Unauthorized" });
        }

        console.log(`Token verified, User ID: ${decoded.userId}`);
        const { roomId, checkIn, checkOut, roomCount } = req.body;
        console.log(`Booking attempt, User ID: ${decoded.userId}`);
        console.log(`Booking request: Room ID ${roomId}, Check-In: ${checkIn}, Check-Out: ${checkOut}, Room Count: ${roomCount}, User ID: ${decoded.userId}`);

        try {
            // Fetch the room from Supabase
            const { data: room, error: roomError } = await supabase
                .from('rooms')
                .select('*')
                .eq('id', roomId)
                .single();

            if (roomError || !room) {
                console.log("Room not found");
                return res.status(404).json({ error: "Room not found" });
            }

            if (room.available < roomCount) {
                console.log("Not enough rooms available");
                return res.status(400).json({ error: "Not enough rooms available" });
            }

            const total = room.price * roomCount;
            const bookingDate = new Date().toISOString();

            // Insert the booking into Supabase
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .insert({
                    user_id: decoded.userId,
                    room_id: roomId,
                    check_in: checkIn,
                    check_out: checkOut,
                    booking_date: bookingDate,
                    room_count: roomCount,
                    total_price: total
                })
                .select()
                .single();

            if (bookingError) {
                console.error("Error creating booking:", bookingError.message);
                return res.status(500).json({ error: "Internal server error" });
            }

            // Update room availability in Supabase
            const { error: updateError } = await supabase
                .from('rooms')
                .update({ available: room.available - roomCount })
                .eq('id', roomId);

            if (updateError) {
                console.error("Error updating room availability:", updateError.message);
                return res.status(500).json({ error: "Internal server error" });
            }

            console.log(`Booking created: Room ID ${roomId}, Room Count: ${roomCount}, Total: ₹${total}, User ID: ${decoded.userId}`);
            res.json({ message: "Booking successful", total });
        } catch (err) {
            console.error("Error during booking:", err.message);
            res.status(500).json({ error: "Internal server error" });
        }
    });
});

app.get("/bookings", async (req, res) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        console.log("No token provided for fetching bookings");
        return res.status(401).json({ error: "Unauthorized" });
    }

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) {
            console.log("Invalid or expired token for fetching bookings");
            return res.status(401).json({ error: "Unauthorized" });
        }

        console.log(`Token verified, User ID: ${decoded.userId}`);
        console.log(`Fetching bookings for user ID: ${decoded.userId}`);

        try {
            const { data: bookings, error } = await supabase
                .from('bookings')
                .select('*, rooms(hotel_name, location, name, amenities)')
                .eq('user_id', decoded.userId)
                .order('booking_date', { ascending: false });

            if (error) {
                console.error("Error fetching bookings:", error.message);
                return res.status(500).json({ error: "Internal server error" });
            }

            // Parse amenities if needed
            const parsedBookings = bookings.map(booking => ({
                ...booking,
                amenities: booking.rooms.amenities
            }));

            console.log("Bookings fetched:", parsedBookings);
            res.json(parsedBookings);
        } catch (err) {
            console.error("Error fetching bookings:", err.message);
            res.status(500).json({ error: "Internal server error" });
        }
    });
});

app.post("/logout", (req, res) => {
    console.log("Logout request received");
    res.json({ message: "Logged out successfully" });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});