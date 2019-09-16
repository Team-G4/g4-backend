import {Client} from "pg"
import Express, { Router } from "express"
import PromiseRouter from "express-promise-router"
import cors from "cors"

import bcrypt from "bcrypt"

import {randomBytes} from "crypto"
import {promisify} from "util"

const cryptoRandomBytesAsync = promisify(randomBytes)

// Hard limit on username length
const USERNAME_LENGTH_LIMIT = 20

// Set up the database
let connectionString = process.env.DATABASE_URL
let db = new Client({
    connectionString: connectionString,
    ssl: true
})

// Set up Express
let expressApp = Express()
expressApp.use(Express.json())
expressApp.use(cors())

// Use express-promise-router to use async/await in callbacks
let router = PromiseRouter()
expressApp.use(router)

// Object type representing player credentials (structure matching the column layout in the DB)
type Credentials = {
    uuid: string,

    username: string,
    hash: string,

    accesstoken: string
}

class Auth {
    /**
     * Gets the credentials of a given player.
     * @param username Player's username.
     */
    static async getCredentials(username: string): Promise<Credentials> {
        try {
            let query = await db.query(
                "SELECT * FROM players WHERE username = $1",
                [username]
            )

            if (!query.rowCount) return null
            return query.rows[0]
        } catch(err) {
            console.error(`Error while accessing credentials: ${err}`)
            return null
        }
    }

    /**
     * Gets the credentials of a player with the given UUID.
     * @param username Player's UUID.
     */
    static async getCredentialsFromUUID(uuid: string): Promise<Credentials> {
        try {
            let query = await db.query(
                "SELECT * FROM players WHERE uuid = $1",
                [uuid]
            )

            if (!query.rowCount) return null
            return query.rows[0]
        } catch(err) {
            console.error(`Error while accessing credentials: ${err}`)
            return null
        }
    }

    /**
     * Generates a random token.
     */
    static async generateToken(): Promise<string> {
        let rngBuffer = await cryptoRandomBytesAsync(24)

        return rngBuffer.toString("hex")
    }

    /**
     * Stores a new player's credentials in the database.
     * @param username Player's username.
     * @param password Player's password in plaintext.
     */
    static async createCredentials(username: string, password: string): Promise<Credentials> {
        try {
            if (username.length > USERNAME_LENGTH_LIMIT) return null

            let hash = await bcrypt.hash(password, 10)
            let accesstoken = await Auth.generateToken()

            let query = await db.query(
                "INSERT INTO players (username, hash, accesstoken) VALUES ($1, $2, $3) RETURNING *",
                [username, hash, accesstoken]
            )

            return query.rows[0]
        } catch(err) {
            console.error(`Error while creating credentials: ${err}`)
            return null
        }
    }

    /**
     * Checks whether the provided plaintext password is correct.
     * @param cred The player credentials from the DB
     * @param password The plaintext password to test
     */
    static async verifyCredentials(cred: Credentials, password: string): Promise<boolean> {
        let matches = await bcrypt.compare(password, cred.hash)

        return matches
    }

    /**
     * Checks whether the provided access token matches the one in the database.
     * @param cred Player credentials
     * @param token Provided access token
     */
    static verifyAccessToken(cred: Credentials, token: string): boolean {
        try {
            return cred.accesstoken === token
        } catch(err) {
            console.error(`Error while verifying the access token: ${err}`)
            return false
        }
    }

    /**
     * Regenerates the access token, returning a new one.
     * @param cred Player credentials
     */
    static async regenerateToken(cred: Credentials): Promise<string> {
        try {
            let newToken = await Auth.generateToken()

            let query = await db.query(
                "UPDATE players SET accesstoken = $2 WHERE uuid = $1",
                [cred.uuid, newToken]
            )

            return newToken
        } catch(err) {
            console.error(`Error while regenerating the access token: ${err}`)
            return null
        }
    }
}

type KnownGameMode = "easy" | "normal" | "hard" | "hell" | "hades" | "denise" | "reverse" | "nox"


// Object type representing a leaderboard score (structure matching the column layout in the DB)
type Score = {
    uuid: string,

    username: string,

    gamemode: string,

    score: number,
    deathcount: number,

    timestamp: string
}
type ScoreNugget = {
    score: number,
    deathcount: number
}

class Leaderboard {
    public static knownGameModes = [
        "easy", "normal", "hard",
        "hell", "hades", "denise",
        "reverse", "nox"
    ]

    /**
     * Retrieves the player's score.
     * @param username Player's username
     * @param mode The game mode
     */
    static async getPlayerScore(username: string, mode: KnownGameMode): Promise<Score> {
        try {
            if (!Leaderboard.knownGameModes.includes(mode)) return null

            let query = await db.query(
                "SELECT * FROM scores WHERE username = $1 AND gamemode = $2",
                [username, mode]
            )

            if (!query.rowCount) return null
            return query.rows[0]
        } catch(err) {
            console.error(`Error while retrieving the score: ${err}`)
            return null
        }
    }

    /**
     * Performs simple score verification.
     * @param current The current leaderboard score
     * @param next The new score sent by the game
     */
    static verifyScore(current: Score, next: ScoreNugget): boolean {
        if (next.score < 0) return false // Block negative scores
        else if (next.score > 999999) return false // Block huge™ scores
        
        if (!current) { // This is the first score in this mode
            return next.score <= 1 // Allow only score 0 or 1
        }

        return next.score == current.score + 1 // Only allow incremental changes to the score
    }

    /**
     * Creates a new leaderboard entry.
     * @param username Player's username
     * @param mode Game mode
     * @param score Score data
     */
    static async createPlayerScore(username: string, mode: KnownGameMode, score: ScoreNugget): Promise<boolean> {
        try {
            if (!Leaderboard.knownGameModes.includes(mode)) return false

            await db.query(
                "INSERT INTO scores (username, gamemode, score, deathcount, timestamp) VALUES ($1, $2, $3, $4, $5)",
                [
                    username,
                    mode,
                    score.score, score.deathcount,
                    Date.now().toString()
                ]
            )

            return true
        } catch(err) {
            console.error(`Error while creating the score: ${err}`)
            return false
        }
    }

    /**
     * Updates a leaderboard entry.
     * @param username Player's username
     * @param mode Game mode
     * @param score Score data
     */
    static async setPlayerScore(username: string, mode: KnownGameMode, score: ScoreNugget): Promise<boolean> {
        try {
            if (!Leaderboard.knownGameModes.includes(mode)) return false

            let currentScore = await Leaderboard.getPlayerScore(username, mode)
            let allowScore = Leaderboard.verifyScore(currentScore, score)

            if (!allowScore) return false
            if (!currentScore) return await Leaderboard.createPlayerScore(
                username, mode, score
            )

            await db.query(
                "UPDATE scores SET score = $2, deathcount = $3, timestamp = $4 WHERE username = $1",
                [
                    username,
                    score.score, score.deathcount,
                    Date.now().toString()
                ]
            )

            return true
        } catch(err) {
            console.error(`Error while setting the score: ${err}`)
            return false
        }
    }

    /**
     * Retrieves a list of top scores for a given mode.
     * @param mode Game mode
     * @param limit No. of scores to return
     */
    static async getModeScores(mode: KnownGameMode, limit: number): Promise<Score[]> {
        try {
            if (!Leaderboard.knownGameModes.includes(mode)) return []

            let query = await db.query(
                "SELECT * FROM scores WHERE gamemode = $1 ORDER BY score DESC LIMIT $2",
                [mode, limit]
            )

            return query.rows
        } catch(err) {
            console.error(`Error while getting the scores: ${err}`)
            return []
        }
    }
}

// The type of the callback used by RequestUtil.processAuthRequest
type AuthRequestCallback = (
    cred: Credentials,
    data: any
) => Promise<Object>

// The structure of the auth request body
type AuthRequestBody = {
    uuid: string,
    accesstoken: string,

    data: any
}

// The structure of the auth response
type AuthRequestResponse = {
    authError: boolean,
    authErrorString: string,

    accesstoken: string,

    successful: boolean,
    data: any
}

class RequestUtil {
    static respond(
        response: Express.Response,
        data: any
    ) {
        response.json(data)
    }

    static respondAuthRequest(
        response: Express.Response,

        accesstoken: string,

        successful: boolean,
        data: any
    ) {
        RequestUtil.respond(
            response,
            {
                authError: false,
                accesstoken,
                successful, data
            }
        )
    }

    static respondAuthRequestErr(
        response: Express.Response,

        authErrorString: string
    ) {
        RequestUtil.respond(
            response,
            {
                authError: true,
                authErrorString
            }
        )
    }


    static async processAuthRequest(
        request: Express.Request,
        response: Express.Response,
        processCallback: AuthRequestCallback
    ) {
        let bodyData: AuthRequestBody = request.body

        // Check whether the auth data is complete
        if (!("uuid" in bodyData))
            return RequestUtil.respondAuthRequestErr(response, "User UUID not provided.")
        else if (!("accesstoken" in bodyData))
            return RequestUtil.respondAuthRequestErr(response, "User access token not provided.")

        // Check whether the user exists and the access token is valid
        let cred = await Auth.getCredentialsFromUUID(bodyData.uuid)
        if (!cred)
            return RequestUtil.respondAuthRequestErr(response, "User UUID is invalid.")
        let tokensMatch = Auth.verifyAccessToken(cred, bodyData.accesstoken)
        if (!tokensMatch)
            return RequestUtil.respondAuthRequestErr(response, "Access token is invalid.")
        
        // Generate a new access token
        let newaccesstoken = await Auth.regenerateToken(cred)

        // Get the data for the request, if none, supply an empty object
        // The callback will handle that
        let requestData = bodyData.data
        if (!requestData) requestData = {}
    
        // Process the request using the provided callback
        let callbackData = await processCallback(cred, requestData)

        // Successful? (error = null returned)
        let successful = callbackData !== null

        // Respond with the new access token and data
        return RequestUtil.respondAuthRequest(
            response,
            newaccesstoken,
            successful, callbackData
        )
    }
}

//// ENDPOINTS ////
// GET /usernameAvailable
router.get(
    "/usernameAvailable",
    async (req, res) => {
        let nameAvailable = false

        if ("username" in req.query) {
            let cred = await Auth.getCredentials(req.query.username)

            if (!cred) nameAvailable = true
        }

        RequestUtil.respond(res, {
            available: nameAvailable
        })
    }
)

// POST /userRegister
router.post(
    "/userRegister",
    async (req, res) => {
        let successful = false
        let uuid = ""
        let accesstoken = ""

        if (
            "username" in req.body &&
            "password" in req.body &&
            req.body.username.length <= USERNAME_LENGTH_LIMIT
        ) {
            let existingCred = await Auth.getCredentials(req.body.username)

            if (!existingCred) {
                let cred = await Auth.createCredentials(
                    req.body.username,
                    req.body.password
                )

                if (cred) {
                    successful = true
                    uuid = cred.uuid
                    accesstoken = cred.accesstoken
                }
            }
        }

        RequestUtil.respond(res, {
            successful,
            uuid,
            accesstoken
        })
    }
)

// POST /userLogin
router.post(
    "/userLogin",
    async (req, res) => {
        let successful = false
        let uuid = ""
        let accesstoken = ""

        if (
            "username" in req.body &&
            "password" in req.body &&
            req.body.username.length <= USERNAME_LENGTH_LIMIT
        ) {
            let existingCred = await Auth.getCredentials(req.body.username)

            if (existingCred) {
                let matches = await Auth.verifyCredentials(existingCred, req.body.password)

                if (matches) {
                    let newAccessToken = await Auth.regenerateToken(existingCred)
    
                    successful = true
                    uuid = existingCred.uuid
                    accesstoken = newAccessToken
                }
            }
        }

        RequestUtil.respond(res, {
            successful,
            uuid,
            accesstoken
        })
    }
)

// GET /scores
router.get(
    "/scores",
    async (req, res) => {
        let mode: KnownGameMode, limit = 50
        let output = []

        if ("mode" in req.query) mode = req.query.mode
        if ("limit" in req.query) limit = +req.query.limit

        if (mode && limit) {
            let scores = await Leaderboard.getModeScores(mode, limit)

            output = scores
        }

        RequestUtil.respond(res, {
            scores: output
        })
    }
)

// POST /score
router.post(
    "/score",
    async (req, res) => {
        RequestUtil.processAuthRequest(
            req, res,
            async (cred: Credentials, data) => {
                if (
                    "mode" in data &&
                    "score" in data &&
                    "deathcount" in data
                ) {
                    let scoreNugget: ScoreNugget = {
                        score: +data.score,
                        deathcount: +data.deathcount
                    }

                    let op = await Leaderboard.setPlayerScore(
                        cred.username,
                        data.mode,
                        scoreNugget
                    )

                    if (!op) return null
                    return true
                }

                return null
            }
        )
    }
)

// Utility function for resetting the database
async function resetDatabase() {
    await db.query(
        `DROP TABLE players;
        DROP TABLE scores;
        CREATE TABLE players (
            uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username varchar,
            hash varchar,
            accesstoken varchar
        );
        CREATE TABLE scores (
            uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username varchar,
            gamemode varchar,
            score integer,
            deathcount integer,
            timestamp varchar
        );`
    )
}

// Connect!
db.connect().then(async () => {
    console.log("Connected to the database.")

    await resetDatabase()

    expressApp.listen(
        process.env.PORT,
        () => {
            console.log(`Listening to requests from port ${process.env.PORT}.`)
        }
    )
})