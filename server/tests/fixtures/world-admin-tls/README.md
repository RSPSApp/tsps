Throwaway self-signed certificates for `world-admin.test.cjs` (localhost and 127.0.0.1, valid
until 2126). They secure nothing. Two pairs, so the tests can swap one for the other:

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout key-a.pem \
  -out cert-a.pem -days 36500 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```
