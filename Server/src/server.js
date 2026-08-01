const app = require('./app');
const config = require('./config');

app.listen(config.PORT, () => console.log(`Server on http://localhost:${config.PORT}`));