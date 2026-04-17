'use strict';

const app    = require('./app');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3003;

app.listen(PORT, () => logger.info(`Cart Service running on port ${PORT}`));

process.on('SIGTERM', () => process.exit(0));
