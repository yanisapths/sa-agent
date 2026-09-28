# Common Go Mistakes

Flag these as bugs or important issues, not style nits.

## Error handling

- Returning `err` from a failed `if` after `err` was overwritten (`if err := ...; err != nil { return err }` shadowing).
- `defer resp.Body.Close()` before checking `http.Get` error (nil dereference).
- Comparing errors with `==` instead of `errors.Is`.
- Wrapping with `%v` instead of `%w` when the caller must inspect the cause.

## Slices, maps, pointers

- Appending a pointer to a loop variable in older Go, or taking `&item` in `for _, item := range` when the pointer escapes — prefer indexing or copying the value.
- Mutating a range-copy and expecting the original slice to change.
- Concurrent map writes without a mutex.
- Returning a slice alias into an internal buffer the caller can mutate.

## Nil and zero values

- Calling methods on a nil interface that holds a typed nil (`var p *T; var i I = p` — `i != nil` is true).
- JSON `omitempty` on `bool` / numeric zero hiding meaningful values; use pointers when "missing" matters.
- `json.Unmarshal` into a non-pointer.

## Concurrency

- Goroutine leaks: missing cancel, blocked send, wait group never `Done`.
- Data races on struct fields (run `go test -race` mentally on any shared state).
- Using `time.After` in a loop (timer leak); use `time.NewTimer` and `Stop`.
- Lock copy: passing a `sync.Mutex` by value (embed in the struct, pass pointers).

## Context

- Using `context.Background()` on a request path instead of `r.Context()` / `c.Request.Context()`.
- Storing request-scoped values for optional parameters instead of explicit args (except auth/trace IDs at the boundary).
- Ignoring cancellation in loops and client calls.

## HTTP and I/O

- Not limiting request body size.
- Reusing `http.DefaultClient` with no timeouts.
- Reading a body twice without buffering.
- Forgetting `defer rows.Close()` or `stmt.Close()`.

## SQL

- `SELECT *` into a struct that will break when columns are added.
- Ignoring `sql.ErrNoRows` vs other errors.
- Holding a transaction open across HTTP calls.

## Tests

- Tests that pass only because they assert mocks were called, not because the behavior is correct.
- Shared package-level DB/state without cleanup.
- Using `t.Fatal` in a helper without `t.Helper()`.
