# ITSupportBackend

A Node.js backend for IT Support, featuring user authentication, password reset, and audit columns for all major tables.

## Features
- User registration, login, and password reset
- Audit columns on all major tables: `CreatedBy`, `CreatedDate`, `UpdatedBy`, `UpdatedDate`, `IsActive`
- JWT-based authentication
- Nodemailer for email notifications
- MySQL database integration

## API Endpoints

### Auth
- `POST /api/auth/register`
  - Registers a new user.
  - Request body: `{ "email": "...", "password": "...", "name": "...", "role": "...", "category": "..." }`
- `POST /api/auth/login`
  - Logs in a user.
  - Request body: `{ "email": "...", "password": "..." }`
- `POST /api/auth/forgot-password`
  - Sends a password reset link to the user's email.
  - Request body: `{ "email": "..." }`
- `POST /api/auth/reset-password`
  - Resets the user's password using a token from the reset link.
  - Request body: `{ "token": "<jwt-token>", "password": "<new-password>" }`

### User
- `GET /api/user/profile`
  - Returns the authenticated user's profile. Requires `Authorization: Bearer <token>` header.

## Audit Columns
All major tables include:
- `CreatedBy`: Who created the record
- `CreatedDate`: When it was created
- `UpdatedBy`: Who last updated it
- `UpdatedDate`: When it was last updated
- `IsActive`: Soft delete or active flag

Controllers automatically populate these columns using the authenticated user's UID (if available).

## Setup
1. Clone the repo and install dependencies:
   ```powershell
   git clone <repo-url>
   cd ITSupportBackend
   npm install
   ```
2. Configure environment variables in a `.env` file:
   ```env
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=yourpassword
   DB_NAME=it_support_new
   JWT_SECRET=your_jwt_secret
   APP_URL=http://localhost:3000
   ```
3. Start the server:
   ```powershell
   node app.js
   ```

## Usage Example
### Register
```http
POST /api/auth/register
Content-Type: application/json
{
  "email": "user@example.com",
  "password": "yourpassword",
  "name": "User Name",
  "role": "1",
  "category": "2"
}
```

### Reset Password
```http
POST /api/auth/reset-password
Content-Type: application/json
{
  "token": "<jwt-token-from-link>",
  "password": "newpassword"
}
```

## License
ISC
