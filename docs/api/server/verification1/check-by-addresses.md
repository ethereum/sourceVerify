# Check by addresses

Checks if contract with the desired chain and address is verified and in the repository. It will only search for perfect matches.

**URL** : `check-by-addresses?addresses={address}&chainIds={chainIds}`

**URL (deprecated)** : `checkByAddresses?addresses={address}&chainIds={chainIds}`

**Method** : `GET`

## Response

**Code** : `200 OK`

**Content** : 

```json
[
    {
        "address": "0x0000A906D248Cc99FB8CB296C8Ad8C6Df05431c9",
        "status": "perfect",
        "chains": ["3"]
    },
    {
        "address": "0x0A67477639a71bf98528280D3724f465A1814740",
        "status": "perfect",
        "chains": ["5", "3"]
    },
    {
        "address": "0x0A67477639a71bf98528280D3724f465A1814741",
        "status": "false"
    },
    {
        "address": "0x0a06cc1Ce1105d90ce01752813449A029906aD7b",
        "status": "perfect",
        "chains": ["5"]
    }
]
```
