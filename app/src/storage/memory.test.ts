import { describeStorageContract } from "./contract";
import { createMemoryStorage } from "./memory";

describeStorageContract("memory", async () => createMemoryStorage());
