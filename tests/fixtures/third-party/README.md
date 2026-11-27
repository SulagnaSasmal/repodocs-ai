# Third-party OpenAPI fixtures

These specs were written by other people, so the adopter tests do not only run against examples written to pass. They are used unchanged.

| File | What it exercises |
| --- | --- |
| `petstore-expanded.yaml` | `allOf`, `$ref` schemas, no security, a 204 response |
| `uspto.yaml` | server variables, a form-encoded request body, a path at `/` |
| `link-example.yaml` | deep paths, response links |
| `api-with-examples.yaml` | named response examples with no schema |
| `callback-example.yaml` | callbacks, query parameters |

Source: the [OpenAPI Initiative's learn.openapis.org examples](https://github.com/OAI/learn.openapis.org/tree/main/examples/v3.0), licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Copyright the OpenAPI Initiative contributors.
