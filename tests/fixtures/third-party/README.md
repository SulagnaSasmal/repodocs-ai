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
| `vonage-conversation.yaml` | request bodies defined under `components/requestBodies`, date examples, nested `oneOf` fields with five shapes, deprecated operations, spec examples that show fields their schema does not define |
| `adyen-checkout.yaml` | a large real OpenAPI 3.1 spec (25 operations, about 630 KB): deep nested `oneOf` request bodies, enums inside arrays, Basic and API-key auth, path parameters with no example, spec examples that give numbers as strings |
| `apideck-crm.yaml` | Apideck CRM API 10.0.0, OpenAPI 3.0.3, 40 operations: deepObject query parameters with nested enums, an API key sent in `Authorization` with a `Bearer` prefix, required header parameters, nullable and minLength fields, `anyOf`, deprecated fields |

Source of the first five: the [OpenAPI Initiative's learn.openapis.org examples](https://github.com/OAI/learn.openapis.org/tree/main/examples/v3.0), licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Copyright the OpenAPI Initiative contributors.

`ably-platform.yaml` is the Ably Platform API 1.1.0 as published in the [APIs.guru OpenAPI Directory](https://github.com/APIs-guru/openapi-directory/blob/main/APIs/ably.io/platform/1.1.0/openapi.yaml) (CC0 1.0), originally from [Ably's open-specs](https://github.com/ably/open-specs). It was the spec used in the v1.2.0 fresh-agent release check.

`vonage-conversation.yaml` is the Vonage (Nexmo) Conversation API 2.0.1 from the [APIs.guru OpenAPI Directory](https://github.com/APIs-guru/openapi-directory/blob/main/APIs/nexmo.com/conversation/2.0.1/openapi.yaml) (CC0 1.0). It was the spec used in the v1.2.1 fresh-agent release check.

`adyen-checkout.yaml` is the Adyen Checkout API v70 from the [APIs.guru OpenAPI Directory](https://github.com/APIs-guru/openapi-directory) (CC0 1.0), originally from [Adyen's adyen-openapi](https://github.com/Adyen/adyen-openapi). It was the spec used in the v1.2.2 fresh-agent release check.

`apideck-crm.yaml` is the Apideck CRM API 10.0.0 from the [APIs.guru OpenAPI Directory](https://github.com/APIs-guru/openapi-directory) (CC0 1.0). It was the spec used in the v1.2.4 fresh-agent release check.
