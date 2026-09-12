---
name: backend-go
description: Implement or review a Go domain package in the admin-service layout — one file per endpoint, constructor-injected handler struct, private per-endpoint repo interface, pgx repo, DTO validate(), hand-written mock, table-driven handler test. Use when writing or reviewing Go handler/repo code, adding an endpoint to an existing domain, or starting a new domain package.
---

# Backend Go package

The reference implementation is `internal/handler/reward-item` in `admin-service`.
Read a sibling file in the domain you are touching before writing a new one, and
copy its shape. Design the contract first with the `backend` skill; this skill is
how that contract becomes Go.

## Package layout

One directory per domain under `internal/handler/<domain>/`, package name with no
separator (`reward-item/` → `package rewarditem`). Fixed file roles:

| File | Holds |
| --- | --- |
| `<verb>_<noun>_handler.go` | One endpoint: its struct, `New…` constructor, `Handler(c *gin.Context)` |
| `interface.go` | One private repo interface per endpoint |
| `repo.go` | Every SQL method, on one repository struct |
| `entity.go` | DB rows — `db:"…"` tags, snake_case columns |
| `model.go` | Request/response DTOs — `json:"…"` camelCase, `validate:"…"`, and their `validate()` methods |
| `error.go` | `Err…` domain sentinels |
| `constants.go` | Status strings, type strings, allowed file extensions |
| `mock.go` | Hand-written repo mocks and `getMock…` fixtures |
| `utils.go` | Package-private helpers |
| `client.go` | Calls to other microservices |
| `<verb>_<noun>_test.go` | Table-driven test for that one handler |

One endpoint per file. A version bump is a new file (`edit_reward_item_handler.go`
→ `edit_reward_item_digital_V2_handler.go`), never an edited old one — the old
route keeps shipping.

## Handler

Unexported struct, exported constructor, method named `Handler`. Dependencies
arrive through the constructor and nothing else; no globals, no package-level
db handle.

```go
type getRewardItemByID struct {
	logger *zap.Logger
	repo   getRewardItemByIDRepo
}

func NewGetRewardItemByID(logger *zap.Logger, repo getRewardItemByIDRepo) *getRewardItemByID {
	return &getRewardItemByID{logger: logger, repo: repo}
}

func (s *getRewardItemByID) Handler(c *gin.Context) { … }
```

Blob copy functions, notification senders, CDN base paths, and config values are
constructor parameters too — passed as function types (`azure.CopyObjectWithinBlobStorageFn`,
`inappnotification.SendGlobalNotificationFn`) so a test can substitute them.

Body order, every time:

1. Bind — `c.ShouldBind(&req)`, or `strconv.Atoi(c.Param("reward_id"))` for a path param.
2. `req.validate()`.
3. Existence and rule checks through the repo, cheapest first.
4. The write.
5. `c.JSON(http.StatusOK, response.NewResponse(response.SuccessCode, response.SuccessMessage, resp))`.

Every failure path is `s.logger.Error(err.Error())`, then one `c.JSON(...)`, then
`return`. Never fall through. Never `panic`. Never return a driver error to the
caller — log `err`, respond with `response.ErrDatabase.Error()`.

Map at the boundary: build the response DTO field by field from the entity, in
the handler. Do not hand an `entity.go` struct to `c.JSON`.

## Response envelope

Only through `admin-service/response`. Code and message always come from the
constants, never a literal:

| Situation | HTTP | Code / message |
| --- | --- | --- |
| Success | 200 | `SuccessCode` / `SuccessMessage` |
| Bind or validate failure, broken business rule | 400 | `InputValidationErrorCode` / `InputValidationErrorMessage` |
| Unknown id | 404 | `DataNotFoundCode` / `DataNotFoundMessage` |
| Query or transaction failure | 500 | `DatabaseErrorCode` / `DatabaseErrorMessage` |
| Downstream service failure | 500 | `ClientErrorCode` / `ThirdPartyErrorCode` |

`error` in the body is a domain sentinel from `error.go`
(`ErrRewardItemNotFound.Error()`) or the validator's composed message — a
sentence the operator can act on. Add the sentinel to `error.go`; do not inline
`errors.New` in a handler.

## Repo interface

`interface.go` holds one unexported interface per endpoint, named
`<endpointName>Repo`, listing only the methods that endpoint calls:

```go
type deleteRewardItemByIDRepo interface {
	InquiryRewardItemByID(ctx context.Context, id int) (*RewardItem, error)
	InquiryRewardRedeemedByID(ctx context.Context, rewardId int) (bool, error)
	DeleteRewardItemByID(ctx context.Context, rewardId int) error
}
```

This is what makes the handler testable without a database, so keep it narrow:
adding a method every endpoint must now implement in its mock is the cost of a
wide interface. `repo.go` satisfies all of them with one struct.

Naming: `Inquiry…` / `Get…` / `List…` read, `Is…` / `Check…` predicate,
`Create…` / `Update…` / `Delete…` write, `Batch…` / `Bulk…` multi-row.
A missing row is `(nil, nil)` for a pointer return, not an error — the handler
turns `nil` into 404.

## Repo

`pgx` over a `*pgxpool.Pool`, raw SQL, no ORM.

```go
type rewardItemRepository struct{ db *pgxpool.Pool }

func NewRewardItemRepository(db *pgxpool.Pool) *rewardItemRepository { … }
```

- Parameters are `$1`, `$2`. Never build SQL with `fmt.Sprintf` or `+`.
- `defer rows.Close()` on every `Query`. `QueryRow(...).Scan(...)` for one row.
- Multi-statement writes: `db.BeginTx(ctx, pgx.TxOptions{IsoLevel: …})`,
  `defer func() { _ = tx.Rollback(ctx) }()` immediately after, `tx.Commit(ctx)`
  at the end. The deferred rollback after a commit is a no-op — that is the point.
- Overlapping-window and other read-then-write invariants need
  `pgx.Serializable`; state the isolation level you chose and why.
- Many rows of the same insert: `pgx.Batch` + `tx.SendBatch`, and check
  `batchResult.Close()` — `errcheck` is enabled.
- Zero rows affected on a write the caller believes must land is `pgx.ErrNoRows`.
- Pass `c.Request.Context()` down; never `context.Background()` in a request path.
- Every `WHERE` and join column needs an index. Flag a missing one explicitly.
- Paginated or listed results need a deterministic `ORDER BY`.

## DTOs and validation

`model.go` holds the request and response types and the validation. Requests
carry `validate:` tags and a `validate()` method; field-level rules go in the
tag, cross-field rules in the method:

```go
type CreateFlashSaleRequest struct {
	StartAt     int64                 `json:"startAt" validate:"required"`
	RewardItems []RewardItemFlashSale `json:"rewardItems" validate:"required,dive"`
}

func (req CreateFlashSaleRequest) validate() error {
	validate := utils.NewValidator()
	if err := validate.Struct(req); err != nil {
		return validate.ComposeValidationError(err)
	}
	// duplicate ids, start before end, end in the future …
	return nil
}
```

`utils.NewValidator()` and `ComposeValidationError` only — do not hand-roll a
validator or return the raw `validator.ValidationErrors`.

Rules that belong here rather than in the handler: uniqueness inside a slice,
time ordering, a window that must be in the future, mutually exclusive fields.

Values crossing a trust boundary get sanitised before storage: rich text through
`sanitizeHTMLInput` (bluemonday, explicit element allowlist), uploads checked
against the extension constants in `constants.go` before the blob copy, wei
amounts through `utils.ToWei` / `utils.ToDecimal` rather than float arithmetic.

## Entities

`entity.go` mirrors the row: `db:"…"` tags, nullable columns as pointers
(`Description *string`, `EndAt *time.Time`), timestamps as `time.Time`.
`*_at` is a system timestamp, `*_date_time` a business one. Take nullability from
`describe_tables` — a non-pointer field on a nullable column is a scan failure
waiting for the first NULL, and the handler dereferencing it is a panic.

## Mocks

Hand-written in `mock.go`, one struct per repo interface, fields holding what
each method returns:

```go
type mockCreateFlashSaleRepo struct {
	returnErrBatchCreateFlashSale error
	retrunIsOverLap               *bool
	returnErrIsOverLap            error
}

func (m mockCreateFlashSaleRepo) IsOverLapWithOtherTimePeriod(
	ctx context.Context, startAt, endAt time.Time,
) (*bool, error) {
	return m.retrunIsOverLap, m.returnErrIsOverLap
}
```

Plus `getMock<Entity>()` fixture builders returning a populated entity, shared by
every test in the package. `pgxmock/v3` is for repo-level tests; handler tests
use these mocks. Do not add a mocking framework or codegen.

## Handler test

One `Test<Handler>` per handler file, table-driven over the *mock*, not over
inputs alone — each case picks a mock configured to fail at one step:

```go
mockSuccess := &mockGetRewardItemByIDRepo{returnRewardItem: getMockRewardItems()}
mockDBErr := &mockGetRewardItemByIDRepo{returnErr: ErrDB}
mockNotFound := &mockGetRewardItemByIDRepo{}

tests := []struct {
	rewardId           string
	repo               getRewardItemByIDRepo
	expectedStatusCode int
	expectedCode       uint64
	expectedMessage    string
	description        string
}{ … }

for index, test := range tests {
	log.Info(fmt.Sprintf("Case No. %d - %s", index, test.description))
	app := gin.New()
	app.GET("/reward-item/:id", NewGetRewardItemByID(log, test.repo).Handler)
	req := httptest.NewRequest(http.MethodGet, "/reward-item/"+test.rewardId, nil)
	req.Header.Set(utils.AuthorizationHeader, "Bearer Token")
	w := httptest.NewRecorder()
	app.ServeHTTP(w, req)
	…
}
```

Assert `w.Code`, then unmarshal into `response.Response` when `w.Code < 300` and
`response.ErrResponse` otherwise, and assert `Code` and `Message`. Register the
route with the same path pattern as `cmd/main.go` — a test on `/:id` proves
nothing about a handler reading `c.Param("reward_id")`.

Every branch that returns a distinct status code is a case, with a `description`.
Cover at minimum: success, unparseable path param, repo error, not found, and
each rejected business rule. Run `go test -v -cover ./internal/handler/<domain>/...`.

## Wiring

Routes are registered in `cmd/main.go`, grouped per domain and version, with one
repository instance shared by the group:

```go
rewardAPI := v1Api.Group("reward-item")
rewardRepo := rewarditem.NewRewardItemRepository(postgresDb)
rewardAPI.GET(":id", rewarditem.NewGetRewardItemByID(logger, rewardRepo).Handler)
rewardAPIV2 := v2Api.Group("reward-item")
rewardAPIV2.GET("", rewarditem.NewGetRewardItemDashboard(logger, rewardRepo).Handler)
```

New behaviour goes on `/v2`; `/v1` is frozen. Path segments are kebab-case,
path params are snake_case (`:reward_id`), query params are camelCase
(`?sortBy=name`). Config reaches the constructor from `cfg`, never read from the
environment inside the package.

## Before you call it done

- Every new `WHERE`/join column has an index, or the gap is written down.
- Every new DDL, config key, and data migration is listed for the runbook.
- `golangci-lint run` clean — `errcheck`, `govet`, `ineffassign`, `staticcheck`, `gosec`.
- The handler test covers every status code the handler can return.
- Nullability in `entity.go` matches `describe_tables`.

Design questions — what the endpoint should be, what it returns — belong to the
`backend` skill. Review checklists, runbook, and naming decisions belong to
`backend-code-review`.
