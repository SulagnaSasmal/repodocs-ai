# Third-party OpenAPI fixtures

These specs were written by other people, so the adopter tests do not only run against examples written to pass. They are used unchanged.

| File | What it exercises |
| --- | --- |
| `petstore-expanded.yaml` | `allOf`, `$ref` schemas, no security, a 204 response |
| `uspto.yaml` | server variables, a form-encoded request body, a path at `/` |
| `link-example.yaml` | deep paths, response links |
| `api-with-examples.yaml` | named response examples with no schema |
| `callback-example.yaml` | callbacks, query parameters |
| `ably-platform.yaml` | a real 22-operation API: `oneOf` request bodies, readOnly and writeOnly fields, enums in bodies, nested objects, basic and bearer auth, `security: []`, a spec example that leaves out a required field |

Source of the first five: the [OpenAPI Initiative's learn.openapis.org examples](https://github.com/OAI/learn.openapis.org/tree/main/examples/v3.0), licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Copyright the OpenAPI Initiative contributors.

`ably-platform.yaml` is the Ably Platform API 1.1.0 as published in the [APIs.guru OpenAPI Directory](https://github.com/APIs-guru/openapi-directory/blob/main/APIs/ably.io/platform/1.1.0/openapi.yaml) (CC0 1.0), originally from [Ably's open-specs](https://github.com/ably/open-specs). It was the spec used in the v1.2.0 fresh-agent release check.
