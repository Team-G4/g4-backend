import {Client} from "pg"
import Express, { Router } from "express"
import PromiseRouter from "express-promise-router"

import bcrypt from "bcrypt"

import {randomBytes} from "crypto"
import {promisify} from "util"

const cryptoRandomBytesAsync = promisify(randomBytes)

// Hard limit on username length
const USERNAME_LENGTH_LIMIT = 20

// Set up the database
let db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: true
})

// Set up Express
let expressApp = Express()
expressApp.use(Express.json())

// Use express-promise-router to use async/await in callbacks
let router = PromiseRouter()
expressApp.use(router)

// Object type representing player credentials (structure matching the column layout in the DB)
type Credentials = {
    uuid: string,

    username: string,
    hash: string,

    accessToken: string
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

            let hash = bcrypt.hash(password, 10)
            let accessToken = Auth.generateToken()
            await Promise.all([hash, accessToken])

            let query = await db.query(
                "INSERT INTO players (username, hash, accessToken) VALUES ($1, $2, $3) RETURNING *",
                [username, hash, accessToken]
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
            return cred.accessToken === token
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
                "UPDATE players SET accessToken = $2 WHERE uuid = $1",
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

    gameMode: string,

    score: number,
    deathCount: number,

    timestamp: string
}
type ScoreNugget = {
    score: number,
    deathCount: number
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
                "SELECT * FROM scores WHERE username = $1, gameMode = $2",
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
                "INSERT INTO scores (username, gameMode, score, deathCount, timestamp) VALUES ($1, $2, $3, $4, $5)",
                [
                    username,
                    mode,
                    score.score, score.deathCount,
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
                "UPDATE scores SET score = $2, deathCount = $3, timestamp = $4 WHERE username = $1",
                [
                    username,
                    score.score, score.deathCount,
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
                "SELECT * FROM scores WHERE gameMode = $1 ORDER BY score DESC LIMIT $2",
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
    accessToken: string,

    data: any
}

// The structure of the auth response
type AuthRequestResponse = {
    authError: boolean,
    authErrorString: string,

    accessToken: string,

    successful: boolean,
    data: any
}

class RequestUtil {
    static respond(
        response: Express.Response,
        data: any
    ) {
        response.append("Access-Control-Allow-Origin", "*") // Allow CORS
        response.json(data)
    }

    static respondAuthRequest(
        response: Express.Response,

        accessToken: string,

        successful: boolean,
        data: any
    ) {
        RequestUtil.respond(
            response,
            {
                authError: false,
                accessToken,
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
        else if (!("accessToken" in bodyData))
            return RequestUtil.respondAuthRequestErr(response, "User access token not provided.")

        // Check whether the user exists and the access token is valid
        let cred = await Auth.getCredentialsFromUUID(bodyData.uuid)
        if (!cred)
            return RequestUtil.respondAuthRequestErr(response, "User UUID is invalid.")
        let tokensMatch = Auth.verifyAccessToken(cred, bodyData.accessToken)
        if (!tokensMatch)
            return RequestUtil.respondAuthRequestErr(response, "Access token is invalid.")
        
        // Generate a new access token
        let newAccessToken = await Auth.regenerateToken(cred)

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
            newAccessToken,
            successful, callbackData
        )
    }
}

//// ENDPOINTS ////
// GET /usernameAvailable
router.get(
    "usernameAvailable",
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
    "userRegister",
    async (req, res) => {
        let successful = false
        let uuid = ""
        let accessToken = ""

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
                    uuid = cred.uuid
                    accessToken = cred.accessToken
                }
            }
        }

        RequestUtil.respond(res, {
            successful,
            uuid,
            accessToken
        })
    }
)

// POST /userLogin
router.post(
    "userLogin",
    async (req, res) => {
        let successful = false
        let uuid = ""
        let accessToken = ""

        if (
            "username" in req.body &&
            "password" in req.body &&
            req.body.username.length <= USERNAME_LENGTH_LIMIT
        ) {
            let existingCred = await Auth.getCredentials(req.body.username)

            if (existingCred) {
                uuid = existingCred.uuid
                accessToken = existingCred.accessToken
            }
        }

        RequestUtil.respond(res, {
            successful,
            uuid,
            accessToken
        })
    }
)

// GET /scores
router.get(
    "scores",
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
    "score",
    async (req, res) => {
        RequestUtil.processAuthRequest(
            req, res,
            async (cred: Credentials, data) => {
                if (
                    "mode" in data &&
                    "score" in data &&
                    "deathCount" in data
                ) {
                    let scoreNugget: ScoreNugget = {
                        score: +data.score,
                        deathCount: +data.deathCount
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

// Connect!
db.connect().then(() => {
    console.log("Connected to the database.")

    expressApp.listen(
        process.env.PORT,
        () => {
            console.log(`Listening to requests from port ${process.env.PORT}.`)
        }
    )
})