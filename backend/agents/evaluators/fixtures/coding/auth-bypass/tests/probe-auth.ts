const root = process.env.EVAL_WORKSPACE;
if (!root) {
  console.error("EVAL_WORKSPACE is required");
  process.exit(1);
}

const { authenticate } = await import(`${root}/src/auth.ts`);

const results = {
  empty: authenticate({ password: "" }),
  null: authenticate({ password: null }),
  missing: authenticate({}),
  wrong: authenticate({ password: "nope" }),
  correct: authenticate({ password: "secret" }),
};

process.stdout.write(JSON.stringify(results));
