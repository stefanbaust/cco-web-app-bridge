import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Observable, Subject, ReplaySubject } from 'rxjs';

declare class POSBridge {
  constructor(options?: { targetOrigin?: string; timeout?: number });
  ready(): Promise<void>;
  destroy(): void;
  getReceipt(): Promise<any>;
  pushEvent(eventType: string, eventData: any): void;
  on(event: string, callback: (data: any) => void): void;
  off(event: string, callback: (data: any) => void): void;
}

@Injectable({ providedIn: 'root' })
export class POSBridgeService implements OnDestroy {
  private bridge: POSBridge;
  private readySubject = new ReplaySubject<void>(1);
  private eventSubjects = new Map<string, Subject<any>>();

  ready$ = this.readySubject.asObservable();

  constructor(private zone: NgZone) {
    this.bridge = new POSBridge();
    this.bridge.ready().then(() => {
      this.zone.run(() => this.readySubject.next());
    });
  }

  ngOnDestroy(): void {
    this.bridge.destroy();
    this.eventSubjects.forEach(s => s.complete());
  }

  async getReceipt(): Promise<any> {
    return this.bridge.getReceipt();
  }

  pushEvent(eventType: string, eventData: any): void {
    this.bridge.pushEvent(eventType, eventData);
  }

  on(event: string): Observable<any> {
    if (!this.eventSubjects.has(event)) {
      const subject = new Subject<any>();
      this.eventSubjects.set(event, subject);
      this.bridge.on(event, (data: any) => {
        this.zone.run(() => subject.next(data));
      });
    }
    return this.eventSubjects.get(event)!.asObservable();
  }
}
