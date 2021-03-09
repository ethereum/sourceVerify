# Attempt contract verification

Sends provided files for verification.

**URL** : `/verify` or `/`

**Method** : `POST`

**Content-Type** : `multipart/form-data` or `application/json`

Regardless of the Content-Type, the body should provide:
- `address`
- `chain`

If using `multipart/form-data`, the files should be in a field named `files`.
If using `application/json`, the files should be in an object under the key `files` so the whole object is of the form:
```json
{
    "address": ...,
    "chain": ...,
    "files": {
        "file-name1.sol": ...,
        "file-name2.sol": ...
    }
}
```

## Responses

**Condition** : The recompiled contract matches the deployed version `perfect`ly.

**Code** : `200 OK`

**Content** : 

```json
{
    "result": [
        {
            "address": "0x0001Db7722Fb4211C24d4aC5E1127353116323d3",
            "status": "perfect"
        }
    ]
}
```
### OR

**Condition** : The recompiled contract matches the deployed version `partial`ly.

**Code** : `200 OK`

**Content** : 

```json
{
    "result": [
        {
            "address": "0x0001Db7722Fb4211C24d4aC5E1127353116323d3",
            "status": "partial"
        }
    ]
}
```

### OR

**Condition** : The contract at the provided address and chain has already been sourcified at timestamp indicated by `storageTimestamp`.

**Code** : `200 OK`

**Content** :
```json
{
    "result": [
        {
            "address": "0x0001Db7722Fb4211C24d4aC5E1127353116323d3",
            "status": "perfect",
            "storageTimestamp":"2020-11-10T14:12:15.665Z"
        }
    ]
}
```

### OR
**Condition** : Missing or invalid parameters received.

**Code** : `400 Bad Request`

**Content** :
```json
{
    "message": "Validation Error: address, chain",
    "errors": [
        {
            "field": "address",
            "message": "Invalid value"
        },
        {
            "field": "chain",
            "message": "Invalid value"
        }
    ]
}
```

### OR
**Condition** : Provided valid address and chain input, but no files. This is interpreted as simply checking whether the contract at the provided address and chain has already been sourcified.

**Code** : `404 Not Found`

**Content** :
```json
{
    "error": "The contract at the provided address has not yet been sourcified."
}
```

### OR

**Condition** : Recompiled bytecode does not match the deployed bytecode.

**Code** : `500 Internal Server Error`

**Content** :
```json
{
    "error": "The deployed and recompiled bytecode don't match."
}
```

### OR

**Condition** : The provided chain does not have a contract deployed at the provided address.

**Code** : `500 Internal Server Error`

**Content** :
```json
{
    "error":"Contract name: RandomName. Ethereum Mainnet does not have a contract deployed at 0x7c90F0C9Eb46391c93d0545dDF4658d3B8DF1866."
}
```

### OR

**Condition** : The provided chain is temporarily unavailable.

**Code** : `500 Internal Server Error`

**Content** :
```json
{
    "error":"Contract name: RandomName. Ethereum Mainnet is temporarily unavailable."
}
```

### OR

**Condition** : Some resources are missing and could not be fetched.

**Code** : `500 Internal Server Error`

**Content** :
```json
{
    "error":"Resource missing; unsuccessful fetching: browser/RandomName.sol"
}
```

### OR

**Condition** : Verifying contracts with immutable variables is not supported for the provided chain.

**Code** : `500 Internal Server Error`

**Content** :
```json
{
    "error":"Contract name: RandomName. Verifying contracts with immutable variables is not supported for Ethereum Mainnet."
}
```