process.env.NODE_ENV = "test";
process.env.MONGODB_URI ??= "mongodb://localhost:27018/printing_erp_test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-min-32-chars-xx";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-min-32-chars-x";
process.env.BCRYPT_ROUNDS = "10";
process.env.LOG_LEVEL = "silent";
