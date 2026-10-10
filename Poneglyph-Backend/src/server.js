require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

app.get('/api/ping', (req, res) => {
    res.json({ message: 'USOF API is alive! 🚀' });
});

app.use('/storage', express.static(path.join(__dirname, 'storage')));
app.use('/api/auth', require('./routes/AuthRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/communities', require('./routes/communityRoutes'));
app.use('/api/categories', require('./routes/categoriesRoutes'));
app.get('/api/all-global-categories', require('./controllers/categoriesController').getAllGlobalCategoriesAsync);

app.listen(PORT, () => {
    console.log(`Server is running: http://localhost:${PORT}`);
});