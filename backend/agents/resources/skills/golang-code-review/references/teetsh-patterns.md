# Teetsh Patterns

Project-specific conventions. Prefer these over generic Go style when they conflict.

## Function Design

Keep one abstraction level per function. Orchestrators describe the flow; helpers hide SQL, I/O, and formatting.

```go
func GetUserData(id int) (*User, error) {
    user, err := findUserByID(id)
    if err != nil {
        return nil, fmt.Errorf("failed to get user data: %w", err)
    }
    return user, nil
}
```

Do not mix query construction, scanning, and business rules in the same function.

## Return Structs for Related Data

If two or more return values belong together, return a struct instead of a long tuple.

```go
// Avoid
func LoadClass(id int) (Class, []Student, int, error)

// Prefer
type ClassData struct {
    Class    Class
    Students []Student
    Count    int
}

func LoadClass(id int) (ClassData, error)
```

Naked `(T, error)` is still correct when there is a single result plus an error.

## REST Structure

Keep domain / repo / service / handler separation:

| Layer | Responsibility |
| --- | --- |
| Domain | Entities, invariants, types |
| Repo | SQL and persistence only |
| Service | Use cases and orchestration |
| Handler | HTTP bind, status codes, mapping to/from DTOs |

Handlers do not query the database. Repos do not encode HTTP status. Services do not parse `gin.Context`.

## Multi-tenancy

Every tenant-scoped query includes `school_id`. Missing `school_id` is a data-leak finding, not a style nit.

```go
const q = `SELECT id, name FROM student WHERE school_id = $1 AND id = $2`

row := db.QueryRow(ctx, q, schoolID, studentID)
```

Do not load a row by primary key alone and then "check" school afterward if a join or `WHERE school_id` can enforce it in SQL.

## Analytics Events

Define tracker events in `pkg/externals/tracker/client.go`. Do not invent event names in handlers or services. New events belong next to the existing client constants/methods.

## Comments

Comments explain why, not what. Delete comments that restate the code. Keep comments for non-obvious constraints, workarounds, and business rules the code cannot show.

```go
// Retry on 409: the payment provider returns conflict while the charge is still settling.
```

## Testing Patterns

Vanilla `testing` only. No testify, gomega, or other assertion libraries — stack traces stay in this repo and there is no extra dependency.

```go
if result != expected {
    t.Errorf("Expected %v, got %v", expected, result)
}
if user == nil {
    t.Fatal("user should not be nil")
}
```

Behavior-driven: assert observable outcomes (status, returned data, persisted rows), not internal call sequences or unexported helper names.

- Test success and error paths.
- Isolate state; do not share globals between cases.
- Name tests after the behavior: `TestCreateStudent_RejectsMissingSchoolID`.
