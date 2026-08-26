function queryFrom(url) {
  const query = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(query, key)) {
      query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
    } else {
      query[key] = value;
    }
  }
  return query;
}

export function mockRequest(path, options = {}) {
  const url = new URL(path, 'https://dashboard.example');
  const headers = {};
  for (const [key, value] of Object.entries(options.headers || {})) {
    headers[key.toLowerCase()] = value;
  }
  if (options.authorization !== undefined) headers.authorization = options.authorization;
  const req = {
    method: options.method || 'GET',
    url: `${url.pathname}${url.search}`,
    query: queryFrom(url),
    headers,
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    },
  };
  return { req, res };
}
