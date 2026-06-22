// A Serverless-style Lambda handler used to test loading real handler modules
// (the "run real handlers instead of binding inline resolvers" use case).
exports.handler = (input) => ({ echoed: input });
