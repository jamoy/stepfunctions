export interface State {
  Type: string;
  Resource: string;
  ItemsPath?: any;
  ResultPath?: any;
  ResultSelector?: any;
  OutputPath?: any;
  Next?: any;
  End?: any;
  Retry?: any;
  MaxAttempts?: any;
}

type opts = {
  Name: string;
  StateMachine: StateMachine;
  Resources: any;
  respectTime: boolean;
  maxWaitTime: number;
  maxConcurrency: number;
}

interface StateMachine {
  StartAt: string;
  States: States
}

interface States {
  [key: string]: State[];
}
