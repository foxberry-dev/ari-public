import type { Question } from './model';

export const exampleQuestions: Question[] = [
  { id: 'B1', title: 'Budget', question: 'What is the spending ceiling?',
    rationale: 'Set a funding limit before choosing a room or buying equipment. The €600 figure is an illustrative starting point.',
    assumption: false, dependsOn: [], alternatives: [{ label: '€600', description: 'A small community-grant budget.', recommended: false }] },
  { id: 'V2', title: 'Venue capacity', question: 'How many people can the room hold?',
    rationale: 'Occupancy includes visitors and volunteers. Obtain the room-specific limit in writing; 24 is a sample, not verified evidence.',
    assumption: true, dependsOn: ['B1'], alternatives: [{ label: '24 people', description: 'Illustrative total occupancy, including volunteers.', recommended: false }] },
  { id: 'R3', title: 'Repair scope', question: 'Which repairs will we offer?',
    rationale: 'Match the activities to volunteer skills and insurance. Electrical work needs separate review.',
    assumption: false, dependsOn: ['B1'], alternatives: [{ label: 'Clothing + mechanical', description: 'Start with clothing and small mechanical items.', recommended: true }] },
  { id: 'A4', title: 'Admission', question: 'How should visitors attend?',
    rationale: 'Arrival patterns shape the queue, the room layout, and volunteer roles.', assumption: false, dependsOn: ['V2'],
    alternatives: [
      { label: 'Booked', description: 'Predictable arrivals, with booking administration.', recommended: false },
      { label: 'Drop-in', description: 'Easy to join, but queues need attention.', recommended: false },
      { label: 'Hybrid', description: 'Reserve some places and keep room for walk-ins.', recommended: true },
    ] },
  { id: 'S5', title: 'Volunteer team', question: 'How many volunteers do we need?',
    rationale: 'Four repairers, one intake volunteer, and one floater is an illustrative draft, not a staffing requirement.',
    assumption: true, dependsOn: ['V2', 'R3', 'A4'], alternatives: [{ label: '6 volunteers', description: 'Reassess against activities and arrival patterns.', recommended: false }] },
  { id: 'L6', title: 'Insurance', question: 'Does venue insurance cover repairs?',
    rationale: 'Obtain written confirmation for the chosen activities and volunteers. An available room does not establish insurance cover.',
    assumption: true, dependsOn: ['V2', 'R3'], alternatives: [] },
];
