#!/bin/sh

service_host="$1"
url="${service_host}/random-mantra"
max_attempts=3
retry_delay=5

response_file="$(mktemp)"
error_file="$(mktemp)"

trap 'rm -f "$response_file" "$error_file"' EXIT

attempt=1

while [ "$attempt" -le "$max_attempts" ]; do
  status="$(
    curl \
      --silent \
      --show-error \
      --connect-timeout 10 \
      --max-time 300 \
      --output "$response_file" \
      --write-out "%{http_code}" \
      "$url" \
      2> "$error_file"
  )"
  curl_exit_code=$?

  if [ "$curl_exit_code" -eq 0 ] \
    && [ "$status" -ge 200 ] \
    && [ "$status" -lt 300 ]; then
    cat "$response_file"
    exit 0
  fi

  if [ "$attempt" -lt "$max_attempts" ]; then
    sleep "$retry_delay"
  fi

  attempt=$((attempt + 1))
done

if [ "$curl_exit_code" -ne 0 ]; then
  error="$(cat "$error_file")"
  printf '%s\n' "${error:-curl failed with exit code $curl_exit_code}" >&2
else
  body="$(cat "$response_file")"

  if [ -n "$body" ]; then
    printf 'HTTP %s: %s\n' "$status" "$body" >&2
  else
    printf 'HTTP %s\n' "$status" >&2
  fi
fi

exit 1
