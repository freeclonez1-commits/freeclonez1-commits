const { handler } = require('../netlify/functions/api');

module.exports = async (req, res) => {
  try {
    let bodyStr = '';
    if (req.body) {
      bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const urlParts = (req.url || '/').split('?');
    const path = urlParts[0];

    const query = {};
    if (req.query) {
      Object.assign(query, req.query);
    }

    const headers = {};
    if (req.headers) {
      for (const key of Object.keys(req.headers)) {
        headers[key.toLowerCase()] = req.headers[key];
      }
    }

    const event = {
      httpMethod: req.method,
      path: path,
      headers: headers,
      queryStringParameters: query,
      body: bodyStr
    };

    const result = await handler(event);

    res.statusCode = result.statusCode || 200;
    if (result.headers) {
      for (const key of Object.keys(result.headers)) {
        res.setHeader(key, result.headers[key]);
      }
    }

    res.end(result.body || '');
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, message: err.message }));
  }
};
