import express from "express";
import mysql from "mysql2";
import session from "express-session";
import passport from "passport";
import { Strategy as DiscordStrategy } from "passport-discord";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Client, GatewayIntentBits } from "discord.js";

// Derive __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();

// Initialize Discord Client
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
});
// Login to Discord with your bot token
client.login(process.env.DISCORD_BOT_TOKEN);

// Initialize the connection only once
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: "utf8mb4", // Ensures utf8mb4 encoding
    connectionLimit: 10, // Allows for concurrent queries without overloading
});

// No need for db.connect() inside each route anymore, as the pool handles it


// Passport setup
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Discord Strategy
passport.use(
    new DiscordStrategy(
        {
            clientID: process.env.DISCORD_CLIENT_ID,
            clientSecret: process.env.DISCORD_CLIENT_SECRET,
            callbackURL: process.env.DISCORD_REDIRECT_URI,
            scope: ["identify", "guilds", "guilds.members.read"],
        },
        async (accessToken, refreshToken, profile, done) => {
            profile.accessToken = accessToken;
            return done(null, profile);
        }
    )
);

app.use(express.static("public")); // Or any directory where your HTML files are stored
// Serve static files from the 'src' folder (for media files like videos)

app.use(express.json());

// Middleware

app.use(session({
    secret: 'your-secret-key', // Replace with a secure key
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' } // Secure cookie only for production
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(async (req, res, next) => {
    if (req.isAuthenticated()) {
        try {
            const guildId = process.env.GUILD_ID;
            const guild = client.guilds.cache.get(guildId); // Assuming client is logged in

            if (!guild) {
                throw new Error("Guild not found");
            }

            const member = await guild.members.fetch(req.user.id);

            // Fetch roles from member object
            const roleNames = member.roles.cache.map(role => role.name);

            // Attach roles to req.user
            req.user.roles = roleNames;
        } catch (error) {
            console.error("Error attaching roles to user:", error);
        }
    }
    next();
});



// Login Route (Check if already authenticated)
app.get("/login", (req, res, next) => {
    if (req.isAuthenticated()) {
        return res.redirect("/dashboard"); // Redirect to dashboard if already logged in
    }
    passport.authenticate("discord")(req, res, next); // Proceed with authentication if not logged in
});

// Callback route after Discord login
app.get("/callback", passport.authenticate("discord", {
        failureRedirect: "/default", // Redirect to /login if authentication fails
    }),
    (req, res) => {
        console.log("/callback starting here?");
        res.redirect("/dashboard"); // Redirect to dashboard after successful login
    }
);

// Dashboard Route (protected)
app.get("/dashboard-data", async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/default"); // Redirect to login if not authenticated
    }

    // Assuming roles have been attached to req.user in the middleware
    const roleNames = req.user.roles || []; // Default to empty array if no roles

    // Prepare the minimal data
    const responseData = {
        username: req.user.username, // Assuming req.user has the username
        userId: req.user.id,         // Assuming req.user has the id
        roles: roleNames,
        isAdmin: roleNames.includes("god"),
        isUser: roleNames.includes("testingBot"),
        notWhiteListed: roleNames.includes("not")
    };

    // Send the data as JSON
    return res.json(responseData);
});


app.get("/dashboard", async (req, res) => {
    console.log("Authenticated User: ", req.user);
    console.log("Is Authenticated: ", req.isAuthenticated ? req.isAuthenticated() : "Not defined");
    if (!req.isAuthenticated()) {
        console.log("dashboard failed going back to default?");
        return res.redirect("/default"); // Redirect to login if not authenticated
    }
    return res.sendFile(path.join(__dirname, "..", "public", "dashboard.html"));
});

app.get("/admin", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/default"); // Redirect to login if not authenticated
    }

    // Ensure the user is an admin
    if (!req.user.roles || !req.user.roles.includes("god")) {
        return res.status(403).send("<h1>Access Denied</h1><p>You do not have permission to access the admin page.</p>");
    }

    // Serve the admin HTML file
    return res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

app.get("/user", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/default"); // Redirect to login if not authenticated
    }

    // Ensure the user has the 'testingBot' role
    if (!req.user.roles || !req.user.roles.includes("testingBot")) {
        return res.status(403).send("<h1>Access Denied</h1><p>You do not have permission to access the user page.</p>");
    }

    // Serve the user HTML file
    return res.sendFile(path.join(__dirname, "..", "public", "user.html"));
});

app.post("/submit-form", async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/default");
    }

    const { score, long_answers, state, note } = req.body;
    const user = req.user;

    // Convert the long_answers array to a JSON string before inserting
    const questionsAnswersJson = JSON.stringify(long_answers);

    const query = `
    INSERT INTO form_submissions 
    (score, username, user_id, roles, questions_answers, state, note) 
    VALUES 
    (?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        score,
        user.username,
        user.id,
        JSON.stringify(user.roles), // Convert roles to JSON string
        questionsAnswersJson, // Store formatted question and answer JSON string
        state,
        note,
    ];

    // Execute the query to insert form data
    db.query(query, values, (error, results) => {
        if (error) {
            console.error("Error inserting form data:", error);
            return res.status(500).send("Error saving form data");
        }

        return res.redirect("/user"); // Redirect after successful form submission
    });
});

app.get("/admin/data", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/default"); // Redirect to login if not authenticated
    }

    // Ensure the user is an admin
    if (!req.user.roles || !req.user.roles.includes("god")) {
        return res.status(403).send("<h1>Access Denied</h1><p>You do not have permission to access the admin page.</p>");
    }

    // SQL query to retrieve form data
    const query = "SELECT * FROM form_submissions";

    db.query(query, (error, results) => {
        if (error) {
            console.error("Error fetching form data:", error);
            return res.status(500).send("Error fetching form data");
        }

        // Send the form data as JSON
        res.json(results);
    });
});

app.post("/admin/delete_ticket", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/default");
    }

    // Ensure the user has the correct role (e.g., 'god')
    if (!Array.isArray(req.user.roles) || !req.user.roles.map((role) => role.toLowerCase()).includes("god")) {
        return res.status(403).send("<h1>Access Denied</h1><p>You do not have permission to delete the ticket</p>");
    }

    const { row_id } = req.body;

    // Validate row_id
    if (!row_id || isNaN(row_id)) {
        return res.status(400).send("Invalid ticket ID");
    }

    const query = "DELETE FROM form_submissions WHERE id = ?";
    const values = [row_id];

    // Perform the database query
    db.query(query, values, (error, results) => {
        if (error) {
            console.error("Error deleting ticket:", error);
            return res.status(500).send("Error deleting ticket");
        }

        if (results.affectedRows === 0) {
            return res.status(404).send("Ticket not found");
        }

        // Send a success response
        res.json({ message: "Ticket deleted successfully", row_id });
    });
});

app.post("/admin/update-state-and-note", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/default");
    }

    // Ensure the user has the correct role (e.g., 'god')
    if (!req.user.roles || !req.user.roles.includes("god")) {
        return res.status(403).send("<h1>Access Denied</h1><p>You do not have permission to update the state or note.</p>");
    }

    const { row_id, state, note, user_id_dc } = req.body;

    // Ensure that required fields are provided
    if (!row_id || !state || !note || !user_id_dc) {
        return res.status(400).send("Missing required fields: row_id, state or note");
    }

    // SQL query to update both the state and note
    const query = "UPDATE form_submissions SET state = ?, note = ? WHERE id = ?";
    const values = [state, note, row_id];

    // Perform the database query
    db.query(query, values, (error, results) => {
        if (error) {
            console.error("Error updating state and note:", error);
            return res.status(500).send("Error updating state and note");
        }

        // Send a success response
        res.json({ message: "State and note updated successfully" });

        // Fetch the user from Discord and send a message

        client.users
            .fetch(user_id_dc)
            .then((user) => {
                // Send a DM to the user
                user.send(`Your form submission has been updated!\n **State:** ${state}\n **Note:** ${note}\n`)
                    .then(() => {
                        console.log("Message sent to the user");
                    })
                    .catch((err) => {
                        console.error("Error sending message:", err);
                    });
            })
            .catch((err) => {
                console.error("Error fetching user from Discord:", err);
            });
    });
});

app.get("/default", (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return res.redirect("/dashboard");
    }
    return res.sendFile(path.join(__dirname, "..", "public", "default.html"));
});


// Default route - automatically redirects to /dashboard if logged in
app.get("/", (req, res) => {
    console.log("/ route req.body: " + JSON.stringify(req.body, null, 2));
    if (req.isAuthenticated()) {
        return res.redirect("/dashboard"); // If logged in, redirect to dashboard
    } else {
        return res.redirect("/default"); // If not logged in, redirect to login
    }
});

app.post("/user/get-correct-answers", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/default"); // Redirect to login if not authenticated
    }

    const questionIds = req.body.questionIds;
    if (!Array.isArray(questionIds) || questionIds.length === 0) {
        return res.status(400).send("No question IDs provided");
    }

    // Create a parameterized query to get the correct answers
    const placeholders = questionIds.map(() => "?").join(", ");
    const query = `
        SELECT id, correct_option
        FROM questions
        WHERE id IN (${placeholders})
    `;

    db.query(query, questionIds, (error, results) => {
        if (error) {
            console.error("Error fetching correct answers:", error);
            return res.status(500).send("Error fetching correct answers");
        }

        res.json(results); // Send the correct answers to the client
    });
});

app.get("/user/questions", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/default"); // Redirect to login if not authenticated
    }

    // Assuming you store previously selected question IDs in an array
    const previousSelectedIds = []; // Example of previous IDs

    // If there are no previous selected IDs, fetch all questions
    let query = `
    SELECT id,question_text,option_a,option_b,option_c,option_d
    FROM questions 
    ORDER BY RAND() 
    LIMIT 10
    `;

    // If there are previous selected IDs, add the NOT IN clause
    if (previousSelectedIds.length > 0) {
        query = `
        SELECT id,question_text,option_a,option_b,option_c,option_d
        FROM questions 
        WHERE id NOT IN (${previousSelectedIds.join(", ")}) 
        ORDER BY RAND() 
        LIMIT 10
        `;
    }

    db.query(query, (error, results) => {
        if (error) {
            console.error("Error fetching form data:", error);
            return res.status(500).send("Error fetching form data");
        }

        res.json(results);
    });
});

app.get("/user/question_long", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/default"); // Redirect to login if not authenticated
    }

    // Assuming you store previously selected question IDs in an array
    const previousSelectedIds = []; // Example of previous IDs

    // If there are no previous selected IDs, fetch all questions
    let query = `
    SELECT * 
    FROM question_long 
    ORDER BY RAND() 
    LIMIT 5
    `;

    // If there are previous selected IDs, add the NOT IN clause
    if (previousSelectedIds.length > 0) {
        query = `
        SELECT * 
        FROM question_long 
        WHERE id NOT IN (${previousSelectedIds.join(", ")}) 
        ORDER BY RAND() 
        LIMIT 5
        `;
    }

    db.query(query, (error, results) => {
        if (error) {
            console.error("Error fetching form data:", error);
            return res.status(500).send("Error fetching form data");
        }

        // Send the form data as JSON with correct_answer field
        results.forEach((question) => {
            question.correct_answer = question.correct_answer; // Ensure this field exists
        });

        res.json(results);
    });
});

// Server start
app.listen(3000, () => console.log("App running on http://localhost:3000"));
