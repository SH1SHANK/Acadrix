/**
 * Real-World Reference Fixture based on "Java Week 01 GA 1.pdf".
 * 
 * Recreates the exact 12-question IIT Madras assessment structure:
 * - Q1: Matching Question (Control Link, Activation Record, Scope, Lifetime)
 * - Q2: MCQ with Python class Demo and methods
 * - Q3: MCQ with Python scoping and functions
 * - Q4: MCQ with Python nested functions and activation records
 * - Q5: MSQ Subtyping with Player and Captain statements
 * - Q6: MCQ Machine language instruction ordering with formatting
 * - Q7: MCQ Static vs Dynamic typing segregation
 * - Q8: MCQ Abstract Data Types & Polyclinic operations
 * - Q9: MCQ Python while-loop arithmetic
 * - Q10: MCQ Python dictionary mutation with unicode quotes
 * - Q11: MSQ Heap memory statements
 * - Q12: MSQ Software interface and specification statements
 */

import { AssignmentDocument, QuestionNode, OptionNode, ContentNode } from "../src/model/document.js";
import { QuestionType, ContentType, MathType, MathFormat } from "../src/model/types.js";

export function createJavaWeek01Fixture() {
  const doc = new AssignmentDocument({
    metadata: {
      title: "Week 1 - Graded Assignment 1",
      course: "JAVA",
      week: "01",
      totalQuestions: 12,
      totalMarks: 12,
      timestamp: "2026-10-06T10:00:00.000Z",
      url: "https://study.iitm.ac.in/courses/java/week1/ga1",
    },
    questions: [
      // Q1: Matching
      new QuestionNode({
        number: 1,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [
          new ContentNode({ type: ContentType.HEADING, value: "Match the following:" }),
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "A. Control Link I. Region of the program where a variable is available for use\nB. Activation Record II. Pointer to the previous activation record\nC. Scope III. Duration/time during which a variable is available in the memory\nD. Lifetime IV. Stores the local variables",
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "A-II, B-I, C-IV, D-III" }),
          new OptionNode({ letter: "B", content: "A-II, B-IV, C-I, D-III" }),
          new OptionNode({ letter: "C", content: "A-II, B-IV, C-III, D-I" }),
          new OptionNode({ letter: "D", content: "A-I, B-IV, C-III, D-II" }),
        ],
      }),

      // Q2: MCQ with Python Class
      new QuestionNode({
        number: 2,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "What will be the output of the following Python code?",
          }),
          // Simulating the gutter artifact seen in the original portal
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "12345678910111213",
          }),
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            attributes: { language: "python" },
            value: `class Demo:\n    def __init__(self, str):\n        self.name = str\n    def print_Demo(self):\n        print(self.name)\n\nobj1 = Demo("IITM")\nobj2 = Demo("Java")\nobj1.print_Demo()\nobj2.print_Demo()`,
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "IITM\nJava" }),
          new OptionNode({ letter: "B", content: "IITM\nIITM" }),
          new OptionNode({ letter: "C", content: "Java\nJava" }),
          new OptionNode({ letter: "D", content: "Java\nIITM" }),
        ],
      }),

      // Q3: MCQ Scoping
      new QuestionNode({
        number: 3,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "What will be the output of the following Python code?",
          }),
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            attributes: { language: "python" },
            value: `i = 42\n\ndef f():\n    j = i + 10\n\nprint(i)\nf()\nprint(j)`,
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "42\n52" }),
          new OptionNode({ letter: "B", content: "42\n0" }),
          new OptionNode({ letter: "C", content: "42 followed by an error" }),
          new OptionNode({ letter: "D", content: "Error" }),
        ],
      }),

      // Q4: MCQ Activation records
      new QuestionNode({
        number: 4,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Consider the Python code given below and choose the correct option.",
          }),
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            attributes: { language: "python" },
            value: `def fun1(x):\n    y = x + 1\n    def fun2(z):\n        z = ((x + y) * (x - y)) * z\n        print(z)\n    fun2(2)\n\nfun1(5)`,
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "x, y, z are stored in the same activation record." }),
          new OptionNode({
            letter: "B",
            content: "x and y both are stored in the same activation record, whereas z is stored in another activation record.",
          }),
          new OptionNode({ letter: "C", content: "x, y, z are each stored in different activation records." }),
          new OptionNode({ letter: "D", content: "None of the above" }),
        ],
      }),

      // Q5: MSQ Subtyping
      new QuestionNode({
        number: 5,
        type: QuestionType.MSQ,
        marks: 1,
        stem: [
          new ContentNode({ type: ContentType.HEADING, value: "Consider the statements given below." }),
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Statement 1: Player is an object that has name, age and role, as its data.",
          }),
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Statement 2: Captain is an object that has name, age, role, date of appointment as a captain, and number of years of experience, as its data.",
          }),
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Identify the correct option regarding subtyping with respect to Player objects and Captain objects.",
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "Captain can be a subtype of Player." }),
          new OptionNode({ letter: "B", content: "Player can be a subtype of Captain." }),
          new OptionNode({ letter: "C", content: "Captain cannot be a subtype of Player." }),
          new OptionNode({ letter: "D", content: "Player cannot be a subtype of Captain." }),
        ],
      }),

      // Q6: MCQ Machine language order
      new QuestionNode({
        number: 6,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Consider writing a 'low level' machine language program to perform the following operation:",
          }),
          new ContentNode({ type: ContentType.HEADING, value: "d = a - b * c" }),
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Identify the correct order to execute the steps given below to perform the given operation.\n1. Load the value from memory location a into register R2.\n2. Load the values from memory locations b and c into registers R1 and R2 respectively.\n3. Subtract the content of R1 from R2 and store the result back into R1.\n4. Multiply the contents of registers R1 and R2 and store the result back into R1.\n5. Store the content of R1 into memory location d.",
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "2 -> 1 -> 4 -> 3 -> 5" }),
          new OptionNode({ letter: "B", content: "2 -> 4 -> 1 -> 3 -> 5" }),
          new OptionNode({ letter: "C", content: "1 -> 2 -> 4 -> 3 -> 5" }),
          new OptionNode({ letter: "D", content: "2 -> 4 -> 5 -> 1 -> 3" }),
        ],
      }),

      // Q7: MCQ Static vs Dynamic Typing
      new QuestionNode({
        number: 7,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Identify the most appropriate segregation of the following features between (A) static and (B) dynamic typing in the context of programming.\n1. A name in the program derives its data type from the assigned value.\n2. Every name needs to be declared with its type in advance.\n3. An uninitialized name has no type.\n4. A name cannot be assigned to an incompatible value.\n5. A name can be assigned to any value, and the type of the value determines the type of the name.\n6. It does not allow any name to be assigned unless it is already declared explicitly with type.\n7. During any assignment, it cannot identify either if it is an assignment for a new name or if it is a reassignment for an existing name.",
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "(A) - 2, 4, 6\n(B) - 1, 3, 5, 7" }),
          new OptionNode({ letter: "B", content: "(A) - 1, 3, 5\n(B) - 2, 4, 6, 7" }),
          new OptionNode({ letter: "C", content: "(A) - 1, 3, 4, 5\n(B) - 2, 4, 7" }),
          new OptionNode({ letter: "D", content: "(A) - 2, 4, 6, 7\n(B) - 1, 3, 5" }),
        ],
      }),

      // Q8: MCQ Abstract types in Polyclinic
      new QuestionNode({
        number: 8,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Consider a polyclinic which has a number of doctors. The doctors have schedules for their visiting days and times. Doctors can update their profiles and change their visiting times. Patients need to register in order to seek appointments with the doctors. Doctors provide prescriptions of various medicines to the patients. Given the above scenario, match the abstract types with the associated set of operations.",
          }),
        ],
        options: [
          new OptionNode({
            letter: "A",
            content: "Doctor type with the operations – add and modify own profile, add and modify visiting timing, seek appointment;\nPrescription with the operation – write prescription;\nMedicine type with the operation – add medicines",
          }),
          new OptionNode({
            letter: "B",
            content: "Doctor type with the operations – add and modify own profile, add and modify visiting timing, write prescription, seek appointment;\nPatient type;\nPrescription type with the operation – write prescription;\nMedicine type with the operation – add medicines",
          }),
          new OptionNode({
            letter: "C",
            content: "Doctor type with the operations – add and modify own profile, add and modify visiting timing, write prescription;\nPatient type with the operation – seek appointment;\nPrescription with the operation – add medicines;\nMedicine type",
          }),
          new OptionNode({
            letter: "D",
            content: "Doctor type with the operations – add and modify own profile, write prescription;\nPatient type with the operations – seek appointment, add and modify visiting timing;\nPrescription with the operation – add medicines",
          }),
        ],
      }),

      // Q9: MCQ Python Arithmetic
      new QuestionNode({
        number: 9,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "What will be the value of num after execution of the following code?",
          }),
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            attributes: { language: "python" },
            value: `def elementSum(n):\n    sum = 0\n    while (n != 0):\n        sum = sum + n % 10\n        n = n // 10\n    return sum\n\nnum = 22\nx = elementSum(num)`,
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "0" }),
          new OptionNode({ letter: "B", content: "22" }),
          new OptionNode({ letter: "C", content: "4" }),
          new OptionNode({ letter: "D", content: "2" }),
          new OptionNode({ letter: "E", content: "10" }),
        ],
      }),

      // Q10: MCQ Python Dictionary
      new QuestionNode({
        number: 10,
        type: QuestionType.MCQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "What will be the value of Dict after execution of the following code?",
          }),
          new ContentNode({
            type: ContentType.CODE_BLOCK,
            attributes: { language: "python" },
            value: `def updateDict(d):\n    d["rollno"] = 12\n\nDict = {"name": "John", "Age": 21}\nupdateDict(Dict)`,
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: '{"rollno" : 12, "Age" : 21}' }),
          new OptionNode({ letter: "B", content: '{"rollno" : 12}' }),
          new OptionNode({ letter: "C", content: '{"name" : "John", "Age" : 21}' }),
          new OptionNode({ letter: "D", content: '{"name" : "John", "Age" : 21, "rollno" : 12}' }),
        ],
      }),

      // Q11: MSQ Heap Memory
      new QuestionNode({
        number: 11,
        type: QuestionType.MSQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Which of the following statements about the heap is/are correct? Select all that apply.",
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "The heap is used to store data that is dynamically allocated at runtime." }),
          new OptionNode({ letter: "B", content: "Activation records (or stack frames) for function calls are stored in the heap." }),
          new OptionNode({ letter: "C", content: "Memory in the heap must be explicitly allocated by the programmer." }),
          new OptionNode({ letter: "D", content: "Memory allocated on the heap cannot be deallocated." }),
        ],
      }),

      // Q12: MSQ Interface & Specification
      new QuestionNode({
        number: 12,
        type: QuestionType.MSQ,
        marks: 1,
        stem: [
          new ContentNode({
            type: ContentType.PARAGRAPH,
            value: "Which of the following statements correctly describe interface and specification in software components?",
          }),
        ],
        options: [
          new OptionNode({ letter: "A", content: "An interface includes function signatures, arguments, and return types." }),
          new OptionNode({ letter: "B", content: "Specification refers to the intended input-output behavior of the component." }),
          new OptionNode({ letter: "C", content: "Interface helps describe how a component is implemented internally." }),
          new OptionNode({ letter: "D", content: "A good specification language should balance abstraction and detail." }),
        ],
      }),
    ],
  });

  return doc;
}
