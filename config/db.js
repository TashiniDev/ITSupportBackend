const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'Tashini258258';
const DB_NAME = process.env.DB_NAME || 'it_support_new';

let pool;

async function init() {
  // First, connect without specifying database to ensure DB exists
  const adminConn = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD
  });
  try {
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
  } finally {
    await adminConn.end();
  }

  // Create pool pointing to the database
  pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS user(
      id INT AUTO_INCREMENT PRIMARY KEY,
      uid VARCHAR(128) UNIQUE,
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE,
      password VARCHAR(255),
      role_id INT DEFAULT NULL,
      category_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_users_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=INNODB;
  `;

  const createRoleTable = `
     CREATE TABLE IF NOT EXISTS \`role\` (
      \`Id\` int NOT NULL AUTO_INCREMENT,
      \`Name\` varchar(100) NOT NULL,
      \`CreatedBy\` varchar(150) DEFAULT NULL,
      \`CreatedDate\` datetime DEFAULT CURRENT_TIMESTAMP,
      \`UpdatedBy\` varchar(150) DEFAULT NULL,
      \`UpdatedDate\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`IsActive\` tinyint(1) DEFAULT '1',
      PRIMARY KEY (\`Id\`)
    ) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  const createCategoryTable = `
     CREATE TABLE IF NOT EXISTS \`category\` (
      \`Id\` int NOT NULL AUTO_INCREMENT,
      \`Name\` varchar(100) NOT NULL,
      \`CreatedBy\` varchar(150) DEFAULT NULL,
      \`CreatedDate\` datetime DEFAULT CURRENT_TIMESTAMP,
      \`UpdatedBy\` varchar(150) DEFAULT NULL,
      \`UpdatedDate\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`IsActive\` tinyint(1) DEFAULT '1',
      PRIMARY KEY (\`Id\`)
    ) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  const createDepartmentTable = `
     CREATE TABLE IF NOT EXISTS \`department\` (
      \`Id\` int NOT NULL AUTO_INCREMENT,
      \`Name\` varchar(100) NOT NULL,
      \`CreatedBy\` varchar(150) DEFAULT NULL,
      \`CreatedDate\` datetime DEFAULT CURRENT_TIMESTAMP,
      \`UpdatedBy\` varchar(150) DEFAULT NULL,
      \`UpdatedDate\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`IsActive\` tinyint(1) DEFAULT '1',
      PRIMARY KEY (\`Id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  const createTicketTable = `
    CREATE TABLE IF NOT EXISTS \`ticket\` (
      \`Id\` int NOT NULL AUTO_INCREMENT,
      \`Name\` varchar(150) NOT NULL,
      \`ContactNumber\` varchar(50) DEFAULT NULL,
      \`AssignerId\` int DEFAULT NULL,
      \`IssueId\` int DEFAULT NULL,
      \`RequestTypeId\` int DEFAULT NULL,
      \`CompanyId\` int DEFAULT NULL,
      \`DepartmentId\` int DEFAULT NULL,
      \`Description\` text DEFAULT NULL,
      \`CategoryId\` int DEFAULT NULL,
      \`Status\` enum('OPEN','IN_PROGRESS','RESOLVED','CLOSED') DEFAULT 'OPEN',
      \`SeverityLevel\` enum('LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'LOW',
      \`CreatedBy\` varchar(150) DEFAULT NULL,
      \`CreatedDate\` datetime DEFAULT CURRENT_TIMESTAMP,
      \`UpdatedBy\` varchar(150) DEFAULT NULL,
      \`UpdatedDate\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`IsActive\` tinyint(1) DEFAULT '1',
      PRIMARY KEY (\`Id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  const createCompanyTable = `
     CREATE TABLE IF NOT EXISTS \`company\` (
      \`Id\` int NOT NULL AUTO_INCREMENT,
      \`Name\` varchar(100) NOT NULL,
      \`CreatedBy\` varchar(150) DEFAULT NULL,
      \`CreatedDate\` datetime DEFAULT CURRENT_TIMESTAMP,
      \`UpdatedBy\` varchar(150) DEFAULT NULL,
      \`UpdatedDate\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`IsActive\` tinyint(1) DEFAULT '1',
      PRIMARY KEY (\`Id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  const createRequestTypeTable = `
     CREATE TABLE IF NOT EXISTS \`requesttype\` (
      \`Id\` int NOT NULL AUTO_INCREMENT,
      \`Name\` varchar(100) NOT NULL,
      \`CreatedBy\` varchar(150) DEFAULT NULL,
      \`CreatedDate\` datetime DEFAULT CURRENT_TIMESTAMP,
      \`UpdatedBy\` varchar(150) DEFAULT NULL,
      \`UpdatedDate\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`IsActive\` tinyint(1) DEFAULT '1',
      PRIMARY KEY (\`Id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  const createIssueTypeTable = `
     CREATE TABLE IF NOT EXISTS \`issuetype\` (
      \`Id\` int NOT NULL AUTO_INCREMENT,
      \`Name\` varchar(100) NOT NULL,
      \`CreatedBy\` varchar(150) DEFAULT NULL,
      \`CreatedDate\` datetime DEFAULT CURRENT_TIMESTAMP,
      \`UpdatedBy\` varchar(150) DEFAULT NULL,
      \`UpdatedDate\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`IsActive\` tinyint(1) DEFAULT '1',
      PRIMARY KEY (\`Id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  const createAttachmentsTable = `
    CREATE TABLE IF NOT EXISTS \`attachments\` (
      \`Id\` int NOT NULL AUTO_INCREMENT,
      \`Path\` varchar(255) NOT NULL,
      \`TicketId\` int NOT NULL,
      \`CreatedBy\` varchar(150) DEFAULT NULL,
      \`CreatedDate\` datetime DEFAULT CURRENT_TIMESTAMP,
      \`UpdatedBy\` varchar(150) DEFAULT NULL,
      \`UpdatedDate\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`IsActive\` tinyint(1) DEFAULT '1',
      PRIMARY KEY (\`Id\`),
      INDEX \`idx_ticket_id\` (\`TicketId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
  `;

  const conn = await pool.getConnection();
  try {
    // Ensure auxiliary tables exist before creating users with FKs
    await conn.query(createRoleTable);
    await conn.query(createCategoryTable);
    await conn.query(createDepartmentTable);
    await conn.query(createCompanyTable);
    await conn.query(createRequestTypeTable);
    await conn.query(createIssueTypeTable);
    await conn.query(createTicketTable);
    await conn.query(createAttachmentsTable);
    await conn.query(createUsersTable);
  } finally {
    conn.release();
  }
}

function getPool() {
  if (!pool) throw new Error('Pool not initialized. Call init() first.');
  return pool;
}

module.exports = { init, getPool, pool }
