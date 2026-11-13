import type { TourStep } from "@/components/tour/tour";

// The words for each tour. Short, and plain enough for a 7-year-old.
// `target` is the data-tour="…" on the real element; steps whose element
// isn't on screen are skipped.

export function homeSteps(folders: boolean): TourStep[] {
  return [
    {
      target: "hero",
      title: "This is Loso",
      body: "You say what video you want. Loso makes it for you.",
    },
    {
      target: "before",
      title: "Read this first",
      body: "Four quick things to know before you start.",
    },
    {
      target: "settings",
      title: "Add your AI key",
      body: "Loso needs an AI key to think. Open Settings and put your key in. It stays on this computer.",
    },
    folders
      ? {
          target: "open",
          title: "Open your folder",
          body: "Pick the folder that has your videos in it. Your new video gets saved there too.",
        }
      : {
          target: "open",
          title: "Pick videos and photos",
          body: "Choose the clips you want to use. They stay on your phone.",
        },
    {
      target: "videos",
      title: "Your videos",
      body: "Every video you make shows up here. Tap one to keep working on it.",
    },
    {
      target: "help",
      title: "See this again",
      body: "Press here any time and Loso shows you around again.",
    },
  ];
}

const CONNECT = {
  when: "connect",
  title: "Add your AI key",
  body: "Loso needs your AI key first. Put it in here. Then you can tell Loso what you want.",
};

export const editorSteps: TourStep[] = [
  {
    target: "stage",
    title: "Your video",
    body: "This is your video. Press play to watch it.",
  },
  {
    target: "chat",
    title: "Tell Loso what you want",
    body: "Write it here, like “Put a big title that says SUNDAY”. Loso does it for you.",
    alt: CONNECT,
  },
  {
    target: "mic",
    title: "Or just say it",
    body: "Press the microphone and talk. Loso writes down what you say.",
  },
  {
    target: "model",
    title: "Loso's helper",
    body: "This is the AI that helps Loso think. Press it to pick a different one.",
  },
  {
    target: "point",
    title: "Point at it",
    body: "Draw a circle on your video to show Loso what to fix.",
  },
  {
    target: "story",
    title: "The story",
    body: "Every piece of your video is a bar here. A longer bar stays on screen longer.",
  },
  {
    target: "make",
    title: "Make the video",
    body: "When it looks right, press this. Loso saves your video.",
  },
  {
    target: "versions",
    title: "Oops? Go back",
    body: "Undo takes back the last change. Versions keeps every change, so you can go back further.",
  },
  {
    target: "settings",
    title: "Settings and Tell us",
    body: "Your AI key lives in Settings. Have an idea, or is something broken? Open Settings, then Tell us.",
  },
  {
    target: "help",
    title: "See this again",
    body: "Press here any time and Loso shows you around again.",
  },
];

// Upright phones show the floating bar ("talk", "phone-pieces", "phone-story");
// sideways phones show tabs ("tab-…"). Whichever isn't on screen is skipped.
export const phoneEditorSteps: TourStep[] = [
  {
    target: "stage",
    title: "Your video",
    body: "This is your video. Tap play to watch it.",
  },
  {
    target: "talk",
    title: "Talk to Loso",
    body: "Tap here, then write or say what you want, like “Put a big title that says SUNDAY”.",
  },
  {
    target: "tab-loso",
    title: "Talk to Loso",
    body: "Tap Loso, then write or say what you want, like “Put a big title that says SUNDAY”.",
    alt: { when: "connect", title: "Add your AI key", body: "Tap Loso and put your AI key in first. Then tell Loso what you want." },
  },
  {
    target: "mic",
    title: "Or just say it",
    body: "Tap the microphone and talk. Loso writes down what you say.",
  },
  {
    target: "model",
    title: "Loso's helper",
    body: "This is the AI that helps Loso think. Tap it to pick a different one.",
  },
  {
    target: "phone-pieces",
    title: "Pieces",
    body: "Everything in your video lives here: clips, words and sounds. Tap one to change it.",
  },
  {
    target: "tab-pieces",
    title: "Pieces",
    body: "Everything in your video lives here: clips, words and sounds. Tap one to change it.",
  },
  {
    target: "phone-story",
    title: "Story",
    body: "See what comes first, and how long each piece stays.",
  },
  {
    target: "tab-story",
    title: "Story",
    body: "See what comes first, and how long each piece stays.",
  },
  {
    target: "make",
    title: "Make the video",
    body: "When it looks right, tap this. Loso saves your video.",
  },
  {
    target: "more",
    title: "More",
    body: "Undo, Versions, Point at it, Settings and Tell us are in here. So is Show me around, to see this again.",
  },
];
