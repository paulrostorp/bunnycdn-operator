import { createK8Secret, getSecret } from "./utils/k8Secret";
import { CoreV1Api } from "@kubernetes/client-node";
import { MongoDBUser } from "./PullZone";
import { MongoClient } from "mongodb";
import { logger } from "./logger";
import crypto from "crypto";

const userExists = async (client: MongoClient, db: string, user: string): Promise<boolean> => {
  const doc = (await client.db(db).command({
    usersInfo: { db, user },
  })) as {
    users: { user: string; db: string }[];
  };
  for (const u of doc.users) {
    if (u.db === db && u.user === user) return true;
  }
  return false;
};

export const createUser = async ({
  mongoClient,
  k8sClient,
  object,
}: {
  mongoClient: MongoClient;
  k8sClient: CoreV1Api;
  object: MongoDBUser;
}): Promise<void> => {
  await mongoClient.connect();
  const { name: user, namespace } = object.metadata;
  const { spec } = object;

  const secretName = `${spec.dbName}.${user}.credentials`;
  let shouldCreate = true;

  if (await userExists(mongoClient, spec.dbName, user)) {
    // #TODO handle role changes
    const secret = await getSecret(k8sClient, secretName, namespace);
    if (secret) {
      // both user and secret exists, all good
      logger.debug("User " + user + " already exists, skipping");
      shouldCreate = false;
    } else {
      // user exists, but not secret, something went wrong... delete user and retry
      logger.debug("User " + user + " already exists, but not the credentials secret, delete and recreate...");
      await mongoClient.db(spec.dbName).removeUser(user);
      shouldCreate = true;
    }
  }

  if (shouldCreate) {
    logger.debug("Creating user: " + user);

    const password = crypto.randomBytes(48).toString("hex");

    await mongoClient.db(spec.dbName).addUser(user, password, { roles: spec.roles.map(role => ({ db: spec.dbName, role })) });
    logger.debug("Successfully created user: " + user);

    const secretData = {
      MONGO_DATABASE: Buffer.from(spec.dbName).toString("base64"),
      MONGO_USERNAME: Buffer.from(user).toString("base64"),
      MONGO_PASSWORD: Buffer.from(password).toString("base64"),
    };

    await createK8Secret(k8sClient, secretName, secretData, namespace, object);
  }
};

export const deleteUser = async ({ mongoClient, object }: { mongoClient: MongoClient; object: MongoDBUser }): Promise<void> => {
  await mongoClient.connect();
  const { name: user } = object.metadata;
  const { spec } = object;

  if (await userExists(mongoClient, spec.dbName, user)) {
    logger.debug("Deleting user: " + user);
    await mongoClient.db(spec.dbName).removeUser(user);
    logger.debug("Successfully deleted user: " + user);
  }
};
