/**
 * Environment Configuration Validator
 * Validates that all required environment variables are set
 */

require('dotenv').config();

const requiredEnvVars = [
    'DB_HOST',
    'DB_USER', 
    'DB_PASSWORD',
    'DB_NAME',
    'JWT_SECRET',
    'MICROSOFT_CLIENT_ID',
    'MICROSOFT_CLIENT_SECRET',
    'MICROSOFT_TENANT_ID',
    'SENDER_EMAIL',
    'SENDER_NAME',
    'SESSION_SECRET'
];

const optionalEnvVars = [
    'PORT',
    'APP_URL',
    'NODE_ENV',
    'MICROSOFT_REDIRECT_URI'
];

function validateEnvironmentVariables() {
    const missingVars = [];
    const warnings = [];

    // Check required variables
    requiredEnvVars.forEach(varName => {
        if (!process.env[varName]) {
            missingVars.push(varName);
        }
    });

    // Check optional variables and set defaults
    if (!process.env.PORT) {
        process.env.PORT = '3000';
        warnings.push('PORT not set, defaulting to 3000');
    }

    if (!process.env.APP_URL) {
        process.env.APP_URL = `http://localhost:${process.env.PORT}`;
        warnings.push(`APP_URL not set, defaulting to ${process.env.APP_URL}`);
    }

    if (!process.env.NODE_ENV) {
        process.env.NODE_ENV = 'development';
        warnings.push('NODE_ENV not set, defaulting to development');
    }

    if (!process.env.MICROSOFT_REDIRECT_URI) {
        process.env.MICROSOFT_REDIRECT_URI = `${process.env.APP_URL}/api/email/callback`;
        warnings.push(`MICROSOFT_REDIRECT_URI not set, defaulting to ${process.env.MICROSOFT_REDIRECT_URI}`);
    }

    // Display warnings
    if (warnings.length > 0) {
        console.warn('⚠️  Environment Variable Warnings:');
        warnings.forEach(warning => console.warn(`   - ${warning}`));
    }

    // Check for missing required variables
    if (missingVars.length > 0) {
        console.error('❌ Missing Required Environment Variables:');
        missingVars.forEach(varName => {
            console.error(`   - ${varName}`);
        });
        console.error('\n📋 Please add these variables to your .env file');
        console.error('💡 Example .env format:');
        console.error('   MICROSOFT_CLIENT_ID=your_client_id_here');
        console.error('   MICROSOFT_CLIENT_SECRET=your_client_secret_here');
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    console.log('✅ All required environment variables are set');
    return true;
}

// Validate configuration on module load
validateEnvironmentVariables();

module.exports = {
    validateEnvironmentVariables,
    requiredEnvVars,
    optionalEnvVars
};