# Chat attachment storage and delivery

The Worker stores attachment bytes in the private `CHAT_ATTACHMENTS` R2 bucket.
D1 keeps the owner, target, upload deadline, claim revision, and deletion journal.
The browser posts one raw file through the shared upload URL builder.
The route registry gives the entry and gate the same method, matcher, and byte limit.
The storage API also accepts decoded bytes independently of the browser transport.
[Attachments](../../docs/protocol/messages-and-attachments.md#attachments) gives the requirements.

## Storage boundary

`storeAttachment` in [attachment-storage.ts](attachment-storage.ts) takes authenticated metadata and decoded bytes or a stream.
It checks current membership and the named target before it creates a record.
It measures the bytes and refuses a decoded total above `ATTACHMENT_MAX_BYTES`.
The byte limit is shared with the composer.
Raw uploads pass the entry-counted source through native `FixedLengthStream` into R2.
The declared length and stream completion must agree before readiness can publish.
Internal callers without a known length use bounded R2 parts without browser part routes or a part table.
Readiness publishes only after the object completes and the owner and target still permit the write.
An upload that loses ownership leaves no usable attachment.
Its failed cleanup keeps a deletion record for another attempt.

Each generated object key stays private.
The uploader ID stays as an opaque identity after account deletion.
Its record does not keep the user's account row alive.
The org foreign key prevents final org deletion before external cleanup finishes.

## Message admission

`resolveMessageAttachments` checks the sender, org, immutable target, expiry, and ready state.
A workspace upload can be used by the uploader's messages in that workspace.
A new-workspace upload names its stable first-message ID.
A failed first start after admission keeps its workspace, its claim, and its files.
Its Try again resumes that workspace, so the claim stays.
A create that fails before admission removes its provisional workspace record.
Only such a failed attempt, with no public workspace record, lets a fresh attempt for that same first message move the claim.
The original draft deadline still applies until a surviving workspace accepts it.

A D1 claim alone proves no acceptance.
`ChatRecords.saveMessage` stores the attachment-use marker with the message in the chat transaction.
A repeated accepted message returns before it attempts a new claim.
`attachmentPath` in [attachment-paths.ts](../../src/shared/attachment-paths.ts) builds each path from the file ID and the original name.
Each path is relative to the workspace repository: `.context/attachments/<digest>/<safe name>`.
The digest hashes the file ID alone.
It uses the first 32 lowercase hexadecimal characters of SHA-256 over the UTF-8 bytes of that ID.
The builder takes no message ID, so each message that uses a file gets the same path for it.
The safe name keeps ASCII letters, digits, dots, underscores, and hyphens.
One hyphen replaces each run of other characters.
The name keeps at most 100 characters, with the last extension in lowercase.
An empty stem or a name made only of dots becomes `file`.
`publicAttachment` in [attachment-record.ts](attachment-record.ts) adds that path as `path` to the public metadata.
The upload reply and each admitted message give that metadata.
Admission stores the same path as `StoredAttachment.relativePath` of the command.
The stored `StoredAttachment.relativePath` is separate from the runner's absolute `RunnerAttachment.path`.
Admission needs no repository folder map, so the first message can arrive before that map exists.

## Dispatch

`AttachmentPreparation.check` in [attachment-delivery.ts](attachment-delivery.ts) gives the [ordered dispatch](history.md) a copy result for each `turn` or `message` command: send when its files are ready, or else wait.
An empty attachment list returns send before any storage or provider call.
A command that waits for its copy holds the later `turn` and `message` commands of its turn.
So the agent gets the messages of that turn in accepted order.
Stop and the commands of other turns do not wait.

Each copy has one owner: one accepted message on one destination computer.
Each check first reads the current sandbox ID of the workspace with `attachmentSandboxId`.
`attachmentCopyKey` in [attachment-record.ts](attachment-record.ts) builds the owner key with SHA-256 over the message ID and that sandbox ID.
The fixed-length digest keeps the stored proof key short, so message IDs need no new length limit.
The key holds no command ID and no runner connection.
`AttachmentPreparation` keeps one owner for each key in memory.
The owner gives its sandbox ID to `prepareMessageAttachments` in [attachment-copy.ts](attachment-copy.ts).
That helper reads the current captured folder map with `workspaceRepositoryLocations`.
`attachmentRepositoryDirectory` in [attachment-paths.ts](attachment-paths.ts) selects the folder of the workspace's own repository.
Before the first attachment, the Worker writes `.context/attachments/.gitignore` with the single byte `*` under that folder.
Then it joins each stored relative path to that folder and streams the file there.
The provider creates missing parent folders, as [File writes](../sandbox/README.md#file-writes) says.
That helper checks the sandbox before each file and after the last file.
It fails when the workspace names another sandbox, so an owner never moves to another computer.
The owner copies through `waitUntil` outside the chat queue.
Stop, runner events, and confirmations keep using that queue during a transfer.
The provider helper accepts an injected HTTP boundary for tests.

A continuation moves an unanswered message to a new turn with a new command ID.
The runner ignores a command ID that it already received, so the continuation needs that new ID.
The continuation keeps the message and its file paths, so its check finds the same owner key.
It waits for a held copy, and it goes out at once after a finished copy.
A reconnect to the same computer also finds the same owner, which then follows the newest connection.
Thus the writes of one message's owner to its paths on one computer never overlap.
That owner writes no copy after its message goes out.
This guarantee covers one accepted message, not every message that uses the file.
Each later message with the same file has its own owner, and it copies the original bytes to that same path again.
So two messages can write that shared path, also while an agent reads it, as [Attachments](../../docs/protocol/message-attachments.md#attachments) says.

Completion enters the chat queue again.
It saves the copy proof with `ChatRecords.saveAttachmentCopy(messageId, sandboxId)`, marks the owner ready, and resumes dispatch.
It does this also when the first command or the first connection of the owner is gone.
When no owner is in memory, as after a restart, the check reads that proof with `ChatRecords.attachmentCopy(messageId, sandboxId)`.
It uses the proof only when each stored relative path of the command is the current shared path of its file.
Such a proof lets the command go out with no new copy.
Dispatch rechecks access, turn eligibility, and the computer identity before it sends the current runner command with paths.
`resolveAttachmentPaths` in [attachment-paths.ts](attachment-paths.ts) reads the current folder map again for each send.
It sends absolute paths also after a restart that recovered a stored proof.
A stored command with an old path cannot reuse its proof.
An old path is the old absolute-path field, or a relative path from the old digest of the message ID and the file ID.
`prepareMessageAttachments` also refuses that path, so its copy fails through the normal failed-turn path.
Try again then admits the current path of each file.
A new computer or a new message gets a new owner key and a new copy.
A failed proof save closes the runner connection and clears the owner.
Redelivery reads any proof that committed before the failure.

A failed copy clears its owner in the chat queue.
`AttachmentPreparation.currentCommand` then finds the current command of the message.
That is the first pending `turn` or `message` command of the message that the newest connection of the owner can still send.
The failure ends the turn of that command, queued or running, through the existing failed-turn path.
After a continuation, that is the new turn, and the earlier turn keeps its end.
The end gives the HTTP error of the copy, or else `attachment_copy_failed`.
Its retry message is the message whose copy failed.
Try again accepts the same text and files under a new message ID, so its files keep their paths.
The new message ID gives a new owner and a new copy of the original bytes.
The end removes each pending command of that turn, so the failure adds no wait for a later message.
When the failed turn was running, the same commit then saves an `interrupt` command for that turn.
That interrupt goes out although the turn has ended, so the runner stops the agent of that turn.
Each new runner connection gets it again until the late end of that turn from the runner removes it.
The interrupt changes no public turn or session state.
So Try again needs no Worker wait, and the runner starts the retry after the old agent process exits.
After that commit, the common turn-end report gives the end to the lifecycle and to device cleanup, as for every other turn end.
A failure fails no turn when the newest connection of its owner has closed, or when the workspace names another sandbox.
The current connection and computer then get their own owner.

## Agent input

After the member's text, the runner adds one line: "The sender attached these files. Read each file before you answer."
The runner then gives the agent the original name, media type, copied absolute path, and `sizeBytes` of each file.
It takes the size from the metadata of the message, with no file read.
`attachmentDescription` in [attachment-description.ts](../../runner/sdk-helper/src/providers/attachment-description.ts) writes that description for the Claude and Codex adapters.
Each description is one line with a JSON object, so a name with quotes or a line break stays inside its value.
Codex also gets each image as a local image input after its file line.
For a message with an image, its read line adds "Each image is also in this message."
A message without attached files gets no read line or file lines.

## Cleanup

The scheduled members cleanup also sweeps expired drafts.
It uses conditional revisions before deleting a ready file.
For a claim, the sweep calls the trusted `expireChatAttachment` RPC of the claiming workspace object.
That RPC checks acceptance in the chat queue.
An accepted file stays while its workspace survives, including Archive and a failed first start.
A create that failed before admission leaves no surviving workspace, so its file returns to its original draft deadline.
An old claim's cleanup cannot delete the revised claim of a new attempt.

Workspace purge deletes its external files after the member fence drains workspace work.
Org purge also deletes unclaimed and hidden-attempt files before it removes D1 ownership.
Each bounded batch renews the cleanup lease.
The sweep also removes completed orphan objects whose upload outlived its record.

## Verification

The attachment tests use local Miniflare R2 and D1.
Storage tests also call the internal storage boundary.
The raw route tests use the real Worker and native R2 in Miniflare.
Copy tests inject a fake grant and signed transfer through `prepareAttachments`.
The copy owner tests use that fake transfer to count the writers of each computer and path, and the writes after delivery.
The later-message test edits the first copy, then checks that the next message writes the original bytes to the same path.
The legacy-path tests store an old absolute or message-derived relative path with a proof, and check that the turn fails.
The fixture never sends a request to a real provider.
The cleanup integration test runs the production scheduled handler through `/__test/scheduled`, with the native workspace object, D1, and R2.
The failed first start integration test keeps a first-message file through the native expiry RPC, a restart, and Try again, with one exact copy.
The claim race and rollback tests call `expireClaimedAttachment` in the chat queue.
The runner provider tests check the description and the image input of each adapter.
See [the test guide](tests.md) for the groups.
