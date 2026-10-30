export interface ReviewWindow extends Window {
  cartReview: {
    requests: string[];
    releases: Array<() => void>;
    render(present: boolean): void;
  };
  reviewSwap: { entered: boolean; release(): void; done: Promise<unknown> };
  reviewUpdateMessages: number;
  reviewDeleteCommitted(): Promise<void>;
  reviewPersistentStorage(method: string, value: unknown): Promise<unknown>;
}

export interface ReviewCartEntry {
  combinedData: {
    classs: string;
    section_details: Array<{
      type: string;
      class_nbr: string;
      section: string;
    }>;
  };
}
