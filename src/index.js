import express from 'express';
import mysql from 'mysql2';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, GatewayIntentBits } from 'discord.js';

// Derive __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();

// Initialize Discord Client
const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
  });
// Login to Discord with your bot token
client.login(process.env.DISCORD_BOT_TOKEN);


// DB connection (replace with your actual credentials)
const db = mysql.createConnection({
    host: process.env.DB_HOST,  // Host of your online database (e.g., 'your-database-host.com')
    user: process.env.DB_USER,  // Your database username
    password: process.env.DB_PASSWORD,  // Your database password
    database: process.env.DB_NAME,  // Your database name
    charset: 'UTF-8'  // Ensures UTF-8 encoding
});

db.connect((err) => {
    if (err) {
        console.error('Database connection error:', err);
        process.exit(1);  // Exit if connection fails
    } else {
        console.log('Connected to MySQL database');
    }
});
// Passport setup
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Discord Strategy
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_REDIRECT_URI,
    scope: ['identify', 'guilds', 'guilds.members.read']
}, async (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken; 
    return done(null, profile);
}));

app.use(express.static('public')); // Or any directory where your HTML files are stored
app.use(express.json());

// Middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());
// Middleware to parse form data (urlencoded)
app.use(express.urlencoded({ extended: true }));


// Login Route (Check if already authenticated)
app.get('/login', (req, res, next) => {
    if (req.isAuthenticated()) {
        return res.redirect('/dashboard');  // Redirect to dashboard if already logged in
    }
    passport.authenticate('discord')(req, res, next);  // Proceed with authentication if not logged in
});

// Callback route after Discord login
app.get('/callback', passport.authenticate('discord', {
    failureRedirect: '/login'  // Redirect to /login if authentication fails
}), (req, res) => {
    res.redirect('/dashboard');  // Redirect to dashboard after successful login
});

// Dashboard Route (protected)
app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');  // Redirect to login if not authenticated
    }

    const guildId = process.env.GUILD_ID;

    // Fetch member data
    const memberUrl = `https://discord.com/api/v10/guilds/${guildId}/members/${req.user.id}`;
    // Fetch all roles in the guild
    const rolesUrl = `https://discord.com/api/v10/guilds/${guildId}/roles`;

    const headers = {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
    };

    try {
        // Fetching member data
        const memberResponse = await fetch(memberUrl, { headers });
        if (!memberResponse.ok) {
            return res.send('<h1>You are not a member of this server or the bot does not have the correct permissions.</h1>');
        }

        const memberData = await memberResponse.json();
        const roleIds = memberData.roles;

        // Fetching roles in the guild
        const rolesResponse = await fetch(rolesUrl, { headers });
        if (!rolesResponse.ok) {
            return res.status(500).send('Error fetching roles.');
        }

        const rolesData = await rolesResponse.json();

        // Map role IDs to role names
        const roleNames = roleIds.map(roleId => {
            const role = rolesData.find(r => r.id === roleId);
            return role ? role.name : 'Unknown Role';  // If role is not found, return 'Unknown Role'
        });

        // Store the roles in the session (user object)
        req.user.roles = roleNames;

        // Render the dashboard page with options based on roles
        let dashboardContent = `<h1>Welcome, ${req.user.username}!</h1><p>Your roles: ${roleNames.join(', ')}</p>`;

        // Show options based on roles
        if (roleNames.includes("god")) {
            dashboardContent += `<a href="/admin">Go to Admin Page</a><br>`;
        }
    
        if (roleNames.includes("testingBot")) {
            dashboardContent += `<a href="/user">Go to User Page</a><br>`;
        }

        // If no special roles, just show a message
        if (!roleNames.includes("god") && !roleNames.includes("testingBot")) {
            dashboardContent += `<p>You do not have access to any special pages.</p>`;
        }

        // Render the dashboard with options
        res.send(dashboardContent);

    } catch (error) {
        console.error('Error fetching guild member data:', error);
        res.status(500).send('An error occurred.');
    }
});

// Admin Route (protected, accessible only by users with the 'god' role)
app.get('/admin', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');  // Redirect to login if not authenticated
    }

    // Ensure the user is an admin
    if (!req.user.roles || !req.user.roles.includes('god')) {
        return res.status(403).send('<h1>Access Denied</h1><p>You do not have permission to access the admin page.</p>');
    }

    // Serve the admin HTML file
    return res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// User Route (protected, accessible only by users with the 'testingBot' role)
app.get('/user', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');  // Redirect to login if not authenticated
    }

    // Ensure the user has the 'testingBot' role
    if (!req.user.roles || !req.user.roles.includes('testingBot')) {
        return res.status(403).send('<h1>Access Denied</h1><p>You do not have permission to access the user page.</p>');
    }

    // Serve the user HTML file
    return res.sendFile(path.join(__dirname, '..', 'public', 'user.html'));
});

app.post('/submit-form', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');
    }

    const { field1, field2, options, radio } = req.body;
    const user = req.user;  // Get the authenticated user

    // SQL query to insert form data into the 'form_data' table
    const query = `
    INSERT INTO form_data (field1, field2, options, radio, username, user_id, roles, time, state, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
    `;

    const values = [field1, field2, options, radio, user.username, user.id, user.roles.join(','), 'pending', '']; // note is empty by default

    db.query(query, values, (error, results) => {
        if (error) {
            console.error('Error inserting form data:', error);
            return res.status(500).send('Error saving form data');
        }

        console.log('Form data inserted into database');
        return res.redirect('/user');  // Redirect after successful form submission
    });
});


// Route to fetch form data for the admin page
app.get('/admin/data', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');  // Redirect to login if not authenticated
    }

    // Ensure the user is an admin
    if (!req.user.roles || !req.user.roles.includes('god')) {
        return res.status(403).send('<h1>Access Denied</h1><p>You do not have permission to access the admin page.</p>');
    }

    // SQL query to retrieve form data
    const query = 'SELECT * FROM form_data';


    db.query(query, (error, results) => {
        if (error) {
            console.error('Error fetching form data:', error);
            return res.status(500).send('Error fetching form data');
        }

        // Send the form data as JSON
        res.json(results);
    });
});



app.post('/admin/update-state-and-note', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');
    }

    // Ensure the user has the correct role (e.g., 'god')
    if (!req.user.roles || !req.user.roles.includes('god')) {
        return res.status(403).send('<h1>Access Denied</h1><p>You do not have permission to update the state or note.</p>');
    }

    const { row_id, state, note,user_id_dc } = req.body;

    // Ensure that required fields are provided
    if (!row_id || !state || !note || !user_id_dc) {
        return res.status(400).send('Missing required fields: row_id, state or note');
    }

    // SQL query to update both the state and note
    const query = 'UPDATE form_data SET state = ?, note = ? WHERE id = ?';
    const values = [state, note, row_id];

    // Perform the database query
    db.query(query, values,(error, results) => {
        if (error) {
            console.error('Error updating state and note:', error);
            return res.status(500).send('Error updating state and note');
        }

        // Send a success response
        res.json({ message: 'State and note updated successfully' });

        console.log(user_id_dc);
        // Fetch the user from Discord and send a message
        client.users.fetch(user_id_dc)
            .then(user => {
                // Send a DM to the user
                user.send(`Your form submission has been updated! State: ${state}, Note: ${note}`)
                    .then(() => {
                        console.log('Message sent to the user');
                    })
                    .catch(err => {
                        console.error('Error sending message:', err);
                    });
            })
            .catch(err => {
                console.error('Error fetching user from Discord:', err);
            });
    });
});





// Default route - automatically redirects to /dashboard if logged in
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/dashboard');  // If logged in, redirect to dashboard
    } else {
        return res.redirect('/login');  // If not logged in, redirect to login
    }
});

// Server start
app.listen(3000, () => console.log('App running on http://localhost:3000'));
