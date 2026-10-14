CREATE TABLE key_value_store (
  key text PRIMARY KEY,
  value text NOT NULL,
  expires_at timestamp with time zone NOT NULL
);

CREATE INDEX idx_kv_expires_at ON key_value_store(expires_at);
