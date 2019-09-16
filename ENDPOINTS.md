# G4 Server Endpoints

## Player authentication

### `GET` /usernameAvailable
Checks the availability of a given username.

#### Query parameters
* `username` - the username to be checked

#### Returns (JSON)
* `available` - Boolean - `true` if the username is available, `false` if not

### `POST` /userRegister
Registers a user in the database.

#### Request parameters (JSON)
* `username` - the player's username
* `password` - the player's password

#### Returns (JSON)
* `successful` - Boolean - `true` if the operation was successful and the account has been created, `false` if not
* `uuid` - String - the player's UUID
* `accessToken` - String - the access token required to perform write operations

### `POST` /userLogin
Checks the validity of the credentials and provides a new access token if they are valid.

#### Request parameters (JSON)
* `username` - the player's username
* `password` - the player's password

#### Returns (JSON)
* `successful` - Boolean - `true` if the credentials are valid, `false` otherwise
* `uuid` - String - the player's UUID
* `accessToken` - String - the new access token

### `POST` /userLogout
Changes the user's access token without returning it back to prevent further actions on the account.

#### Request parameters (JSON)
* `uuid` - user ID

#### Returns (JSON)
* `successful` - Boolean - always `true`

## Leaderboard

### `GET` /scores
Retrieves the scores for a given game mode.

#### Query parameters
* `mode` - the game mode
* `limit` (optional) - the number of top scores to retrieve (default: 50)

#### Returns (JSON)
* `scores` - Array - an array of scores

### `POST` /score
Sets a player's score.

#### Request parameters (JSON)
* `uuid` - the player's UUID
* `accessToken` - the player's access token
* `data` - an object with properties:
    * `mode` - game mode
    * `score` - score
    * `deathCount` - death count

#### Returns (JSON)
* `authError` - Boolean - `true` if an auth-related error occured, `false` otherwise
* `authErrorString` - String - present if `authError = true`
* `accessToken` - String - the new access token
* `successful` - Boolean - indicates whether the operation was successful