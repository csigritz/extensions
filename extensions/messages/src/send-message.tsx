import {
  Action,
  ActionPanel,
  closeMainWindow,
  environment,
  Form,
  getPreferenceValues,
  Icon,
  LaunchProps,
  open,
  showToast,
  Toast,
} from "@raycast/api";
import { useForm, runAppleScript, useCachedPromise, FormValidation, getAvatarIcon } from "@raycast/utils";
import { useEffect, useMemo } from "react";
import { fetchAllContacts } from "swift:../swift/contacts";

type Contact = {
  id: string;
  givenName: string;
  familyName: string;
  phoneNumbers: string[];
  emailAddresses: string[];
};

function createDeeplink(contactId: string, address: string, text: string) {
  const protocol = environment.raycastVersion.includes("alpha") ? "raycastinternal://" : "raycast://";
  const context = encodeURIComponent(JSON.stringify({ contactId, address, text }));
  return `${protocol}extensions/thomaslombart/messages/send-message?launchContext=${context}`;
}

function getName(contact: Contact) {
  return `${contact.givenName}${contact.familyName ? ` ${contact.familyName}` : ""}`;
}

async function isMessagesAppRunning() {
  const result = await runAppleScript(
    `
    tell application "System Events"
      return (count of (every process whose name is "Messages")) > 0
    end tell
    `,
  );
  return result === "true";
}

async function quitMessagesApp() {
  await runAppleScript(
    `
    tell application "Messages"
      quit
    end tell
    `,
  );
}

type Values = {
  text: string;
  contact: string;
  address: string;
};

type LaunchContext = {
  contactId: string;
  address: string;
  text: string;
};

export default function Command({
  draftValues,
  launchContext,
}: LaunchProps<{
  draftValues: Values;
  launchContext: LaunchContext;
}>) {
  const { shouldCloseMainWindow } = getPreferenceValues<{ shouldCloseMainWindow: boolean }>();
  const { data: contacts, isLoading } = useCachedPromise(
    async () => {
      const contacts = await fetchAllContacts();
      return contacts as Contact[];
    },
    [],
    {
      failureToastOptions: {
        title: "Could not get contacts",
        message: "Make sure you have granted Raycast access to your contacts.",
        primaryAction: {
          title: "Open System Preferences",
          onAction() {
            open("x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts");
          },
        },
      },
    },
  );

  const { itemProps, handleSubmit, values, reset, focus } = useForm<Values>({
    async onSubmit(values) {
      const correspondingContact = contacts?.find((contact) => contact.id === values.contact);
      if (!correspondingContact) {
        showToast({ style: Toast.Style.Failure, title: "Could not send message", message: "Contact not found" });
        return;
      }

      const wasMessagesRunning = await isMessagesAppRunning();

      const result = await runAppleScript(
        `
        on run argv
          try
            tell application "Messages"
              set targetBuddy to item 1 of argv
              set targetService to id of 1st account
              set textMessage to item 2 of argv
              set theBuddy to participant targetBuddy of account id targetService
              send textMessage to theBuddy
            end tell
            return "Success"
          on error error_message
            return error_message
          end try
        end run
      `,
        [values.address, values.text],
      );

      if (result === "Success") {
        const name = getName(correspondingContact);

        if (shouldCloseMainWindow) {
          await closeMainWindow({ clearRootSearch: true });
        }

        if (!wasMessagesRunning) {
          await quitMessagesApp();
        }

        await showToast({
          style: Toast.Style.Success,
          title: `Sent Message to ${name}`,
          message: values.text,
          primaryAction: {
            title: `Open Chat with ${name}`,
            onAction() {
              open(`imessage://${values.address.replace(/\s/g, "")}`);
            },
          },
        });

        reset({ text: "" });
      } else {
        await showToast({ style: Toast.Style.Failure, title: "Could not send message", message: result });
      }
    },
    initialValues: {
      contact: draftValues?.contact ?? launchContext?.contactId ?? "",
      address: draftValues?.address ?? launchContext?.address ?? "",
      text: draftValues?.text ?? launchContext?.text ?? "",
    },
    validation: {
      contact: FormValidation.Required,
      address: FormValidation.Required,
      text: FormValidation.Required,
    },
  });

  const contactAddresses = useMemo(() => {
    const contact = contacts?.find((c) => c.id === values.contact);
    return [...(contact?.phoneNumbers ?? []), ...(contact?.emailAddresses ?? [])];
  }, [values.contact]);

  useEffect(() => {
    if (launchContext?.contactId) {
      focus("text");
    }
  }, []);

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm icon={Icon.SpeechBubble} title="Send Message" onSubmit={handleSubmit} />

          <ActionPanel.Section>
            <Action.CreateQuicklink
              title="Create Messages Quicklink"
              icon={{ fileIcon: "/System/Applications/Messages.app" }}
              quicklink={{
                link: `sms:${values.address}`,
                name: `Send Message to ${contacts?.find((c) => c.id === values.contact)?.givenName}`,
              }}
            />
            <Action.CreateQuicklink
              title="Create Raycast Quicklink"
              quicklink={{
                link: createDeeplink(values.contact, values.address, values.text),
                name: `Send Message to ${contacts?.find((c) => c.id === values.contact)?.givenName}`,
              }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
      enableDrafts
    >
      <Form.Dropdown {...itemProps.contact} title="Contact" storeValue>
        {contacts
          ?.filter((c) => c.givenName || c.familyName)
          .map((contact, i) => {
            const name = getName(contact);
            return (
              <Form.Dropdown.Item
                key={i}
                title={`${name.trim()}`}
                icon={getAvatarIcon(name)}
                keywords={[contact.givenName, contact.familyName, ...contact.phoneNumbers, ...contact.emailAddresses]}
                value={contact.id}
              />
            );
          })}
      </Form.Dropdown>
      <Form.Dropdown {...itemProps.address} title="Address" storeValue>
        {contactAddresses?.map((address) => {
          return <Form.Dropdown.Item key={address} title={address} value={address} />;
        })}
      </Form.Dropdown>
      <Form.TextArea {...itemProps.text} title="Message" />
    </Form>
  );
}
