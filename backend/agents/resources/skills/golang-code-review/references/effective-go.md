# Effective Go (review checklist)

Use this for general code quality. Project rules in `teetsh-patterns.md` win on conflict.

## Naming

- Packages: short, lowercase, no underscores (`user`, not `user_service`).
- MixedCaps for exported names; `ID`, `URL`, `HTTP` stay uppercase.
- Getters are `Name()`, not `GetName()`.
- Interface names often end in `-er` when they have one method (`Reader`, `Closer`).

## Errors

Wrap with context using `%w` so callers can `errors.Is` / `errors.As`:

```go
return fmt.Errorf("update student %d: %w", id, err)
```

Do not discard errors. Do not use `_ = err` to silence a real failure. Sentinel errors live in the package that owns them.

Handle errors once: log **or** return, not both, unless the boundary (handler) must log and respond.

## Interfaces

Accept interfaces, return structs. Define interfaces on the consumer side, narrow to the methods actually used.

```go
func NewHandler(repo StudentRepo) *Handler
```

Do not export a large interface "for mocking" from the producer package when the consumer only needs two methods.

## Resource management

`defer` close/unlock/rollback immediately after a successful acquire:

```go
rows, err := db.Query(ctx, q, args...)
if err != nil {
    return err
}
defer rows.Close()
```

Check `rows.Err()` after iteration. Unlock mutexes with `defer`. Rollback transactions with `defer`; commit explicitly on the success path.

## Concurrency

- Every goroutine must have a documented exit (context cancel, channel close, wait group).
- Do not close a channel from the receiver side; do not send on a closed channel.
- Protect shared memory with a mutex or confine it to one goroutine — not both ad hoc.
- Prefer `errgroup` / `WaitGroup` over fire-and-forget goroutines in request paths.

## Control flow

Prefer early returns over nested `if err == nil` pyramids. Use `switch` for type/value dispatch. Keep functions short enough that the happy path reads top to bottom.

## Packages and structure

- Avoid `util` / `common` grab-bags.
- Keep independent packages from importing each other; extract a smaller shared package if needed.
- Table-driven tests live next to the code they cover (`foo_test.go`).

## Documentation

Exported identifiers get a comment starting with the name. Package comments belong in `doc.go` or the main file. Do not comment the obvious.
