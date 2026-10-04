#!/usr/bin/env node
/**
 * Visual PDF Samples Generator.
 * 
 * Generates standalone HTML documents from canonical AssignmentDocument fixtures,
 * invokes Google Chrome in headless mode to render high-fidelity PDFs,
 * and uses macOS `sips` to convert the PDFs to PNGs for visual inspection.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { ContentType, QuestionType, MathType, MathFormat } from "../src/model/types.js";
import { ContentNode, OptionNode, QuestionNode, AssignmentDocument } from "../src/model/document.js";
import { renderPdfDocument } from "../src/exporters/pdf.js";

const OUT_DIR = "build/pdf-samples";
if (!existsSync(OUT_DIR)) {
  mkdirSync(OUT_DIR, { recursive: true });
}

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Sample 1: Simple Assignment
const docSimple = new AssignmentDocument({
  metadata: {
    title: "Introduction to Machine Learning — Quiz 1",
    course: "CS101 Machine Learning",
    totalQuestions: 2,
    totalMarks: 5,
  },
  questions: [
    new QuestionNode({
      number: 1,
      label: "Question 1 — Conceptual",
      type: QuestionType.MCQ,
      marks: 2.5,
      stem: [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "Which of the following optimization algorithms uses both momentum and adaptive learning rates?" }),
          ],
        }),
      ],
      options: [
        new OptionNode({
          index: 0,
          letter: "A",
          content: [new ContentNode({ type: ContentType.TEXT, value: "Stochastic Gradient Descent (SGD)" })],
        }),
        new OptionNode({
          index: 1,
          letter: "B",
          content: [new ContentNode({ type: ContentType.TEXT, value: "RMSprop" })],
        }),
        new OptionNode({
          index: 2,
          letter: "C",
          content: [new ContentNode({ type: ContentType.TEXT, value: "Adam (Adaptive Moment Estimation)" })],
        }),
        new OptionNode({
          index: 3,
          letter: "D",
          content: [new ContentNode({ type: ContentType.TEXT, value: "Adagrad" })],
        }),
      ],
    }),
    new QuestionNode({
      number: 2,
      label: "Question 2 — Properties",
      type: QuestionType.MSQ,
      marks: 2.5,
      stem: [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "Select all valid regularization techniques used to prevent overfitting in deep neural networks:" }),
          ],
        }),
      ],
      options: [
        new OptionNode({ index: 0, letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "L2 weight decay" })] }),
        new OptionNode({ index: 1, letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "Dropout" })] }),
        new OptionNode({ index: 2, letter: "C", content: [new ContentNode({ type: ContentType.TEXT, value: "Batch Normalization" })] }),
        new OptionNode({ index: 3, letter: "D", content: [new ContentNode({ type: ContentType.TEXT, value: "Increasing the number of hidden layers without data augmentation" })] }),
      ],
    }),
  ],
});

// Sample 2: Math-Heavy Assignment
const docMath = new AssignmentDocument({
  metadata: {
    title: "Linear Algebra & Optimization — Graded Assignment",
    course: "MA2001 Applied Mathematics",
    totalQuestions: 2,
    totalMarks: 6,
  },
  questions: [
    new QuestionNode({
      number: 1,
      label: "Question 1 — Spectral Decomposition",
      type: QuestionType.MCQ,
      marks: 3,
      stem: [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "Let " }),
            new ContentNode({
              type: ContentType.MATH,
              attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              value: "A \\in \\mathbb{R}^{n \\times n}",
            }),
            new ContentNode({ type: ContentType.TEXT, value: " be a symmetric positive definite matrix with eigenvalues " }),
            new ContentNode({
              type: ContentType.MATH,
              attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              value: "\\lambda_1 \\ge \\lambda_2 \\ge \\dots \\ge \\lambda_n > 0",
            }),
            new ContentNode({ type: ContentType.TEXT, value: ". Consider the quadratic form:" }),
          ],
        }),
        new ContentNode({
          type: ContentType.MATH,
          attributes: { format: MathFormat.TEX, mathType: MathType.DISPLAY },
          value: "f(x) = \\frac{1}{2} x^T A x - b^T x + c",
        }),
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "The unique global minimizer of " }),
            new ContentNode({
              type: ContentType.MATH,
              attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              value: "f(x)",
            }),
            new ContentNode({ type: ContentType.TEXT, value: " is given by:" }),
          ],
        }),
      ],
      options: [
        new OptionNode({
          index: 0,
          letter: "A",
          content: [
            new ContentNode({
              type: ContentType.MATH,
              attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              value: "x^* = A^{-1} b",
            }),
          ],
        }),
        new OptionNode({
          index: 1,
          letter: "B",
          content: [
            new ContentNode({
              type: ContentType.MATH,
              attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              value: "x^* = A b",
            }),
          ],
        }),
        new OptionNode({
          index: 2,
          letter: "C",
          content: [
            new ContentNode({
              type: ContentType.MATH,
              attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              value: "x^* = \\frac{1}{2} A^{-1} b",
            }),
          ],
        }),
        new OptionNode({
          index: 3,
          letter: "D",
          content: [
            new ContentNode({
              type: ContentType.MATH,
              attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              value: "x^* = b^T A b",
            }),
          ],
        }),
      ],
    }),
    new QuestionNode({
      number: 2,
      label: "Question 2 — Gaussian Distribution",
      type: QuestionType.NUMERICAL,
      marks: 3,
      stem: [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "The multivariate Gaussian density function in " }),
            new ContentNode({
              type: ContentType.MATH,
              attributes: { format: MathFormat.TEX, mathType: MathType.INLINE },
              value: "D",
            }),
            new ContentNode({ type: ContentType.TEXT, value: " dimensions is:" }),
          ],
        }),
        new ContentNode({
          type: ContentType.MATH,
          attributes: { format: MathFormat.TEX, mathType: MathType.DISPLAY },
          value: "\\mathcal{N}(x \\mid \\mu, \\Sigma) = \\frac{1}{(2\\pi)^{D/2} |\\Sigma|^{1/2}} \\exp\\left( -\\frac{1}{2}(x - \\mu)^T \\Sigma^{-1} (x - \\mu) \\right)",
        }),
      ],
    }),
    new QuestionNode({
      number: 3,
      label: "Question 3 — Native MathML Representation",
      type: QuestionType.MCQ,
      marks: 3,
      stem: [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "The standard normal distribution probability density function rendered via native MathML:" }),
          ],
        }),
        new ContentNode({
          type: ContentType.MATH,
          attributes: { format: MathFormat.MATHML, mathType: MathType.DISPLAY },
          value: '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow><mi>f</mi><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo><mo>=</mo><mfrac><mn>1</mn><mrow><msqrt><mrow><mn>2</mn><mi>π</mi></mrow></msqrt></mrow></mfrac><msup><mi>e</mi><mrow><mo>−</mo><mfrac><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><mn>2</mn></mfrac></mrow></msup></mrow></math>',
        }),
      ],
      options: [
        new OptionNode({
          index: 0,
          letter: "A",
          content: [new ContentNode({ type: ContentType.TEXT, value: "Symmetric about x = 0" })],
        }),
        new OptionNode({
          index: 1,
          letter: "B",
          content: [new ContentNode({ type: ContentType.TEXT, value: "Total area under curve equals 1" })],
        }),
      ],
    }),
  ],
});

// Sample 3: Code Assignment
const docCode = new AssignmentDocument({
  metadata: {
    title: "Data Structures & Algorithms in Python",
    course: "CS2002 DSA",
    totalQuestions: 1,
    totalMarks: 4,
  },
  questions: [
    new QuestionNode({
      number: 1,
      label: "Question 1 — QuickSort Implementation",
      type: QuestionType.MCQ,
      marks: 4,
      stem: [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "Analyze the following Python implementation of recursive QuickSort:" }),
          ],
        }),
        new ContentNode({
          type: ContentType.CODE_BLOCK,
          attributes: { language: "python" },
          value: `def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)

# Test execution:
data = [3, 6, 8, 10, 1, 2, 1]
print(quicksort(data))`,
        }),
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "What is the worst-case space complexity of this specific implementation due to auxiliary list allocations?" }),
          ],
        }),
      ],
      options: [
        new OptionNode({ index: 0, letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "O(log n)" })] }),
        new OptionNode({ index: 1, letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "O(n)" })] }),
        new OptionNode({ index: 2, letter: "C", content: [new ContentNode({ type: ContentType.TEXT, value: "O(n log n)" })] }),
        new OptionNode({ index: 3, letter: "D", content: [new ContentNode({ type: ContentType.TEXT, value: "O(n^2)" })] }),
      ],
    }),
  ],
});

// Sample 4: Table Assignment
const docTable = new AssignmentDocument({
  metadata: {
    title: "Database Management Systems — Relational Algebra",
    course: "CS3001 DBMS",
    totalQuestions: 1,
    totalMarks: 5,
  },
  questions: [
    new QuestionNode({
      number: 1,
      label: "Question 1 — Query Evaluation",
      type: QuestionType.MCQ,
      marks: 5,
      stem: [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "Consider the following relational schema with student examination scores:" }),
          ],
        }),
        new ContentNode({
          type: ContentType.TABLE,
          attributes: { caption: "Table 1: Student Course Performance Metrics" },
          children: [
            new ContentNode({
              type: ContentType.TABLE_ROW,
              children: [
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { isHeader: true, align: "center" }, value: "Roll No" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { isHeader: true, align: "left" }, value: "Student Name" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { isHeader: true, align: "right" }, value: "Midterm (30)" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { isHeader: true, align: "right" }, value: "Endterm (50)" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { isHeader: true, align: "right" }, value: "Total (100)" }),
              ],
            }),
            new ContentNode({
              type: ContentType.TABLE_ROW,
              children: [
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "center" }, value: "21BDS001" }),
                new ContentNode({ type: ContentType.TABLE_CELL, value: "Aarav Sharma" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "right" }, value: "28.5" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "right" }, value: "47.0" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "right" }, value: "95.5" }),
              ],
            }),
            new ContentNode({
              type: ContentType.TABLE_ROW,
              children: [
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "center" }, value: "21BDS002" }),
                new ContentNode({ type: ContentType.TABLE_CELL, value: "Diya Patel" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "right" }, value: "26.0" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "right" }, value: "45.5" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "right" }, value: "91.5" }),
              ],
            }),
            new ContentNode({
              type: ContentType.TABLE_ROW,
              children: [
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "center" }, value: "21BDS003" }),
                new ContentNode({ type: ContentType.TABLE_CELL, value: "Rohan Verma" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "right" }, value: "24.0" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "right" }, value: "42.0" }),
                new ContentNode({ type: ContentType.TABLE_CELL, attributes: { align: "right" }, value: "86.0" }),
              ],
            }),
          ],
        }),
      ],
      options: [
        new OptionNode({ index: 0, letter: "A", content: [new ContentNode({ type: ContentType.TEXT, value: "All students scored above 85 total marks." })] }),
        new OptionNode({ index: 1, letter: "B", content: [new ContentNode({ type: ContentType.TEXT, value: "The average midterm score is below 25.0." })] }),
      ],
    }),
  ],
});

// Sample 5: Realistic Multi-Page Mixed Assignment with SVG Diagram
const docMixed = new AssignmentDocument({
  metadata: {
    title: "Comprehensive Engineering Evaluation — Midterm Exam",
    course: "EE201 Signals, Systems, and Computing",
    totalQuestions: 3,
    totalMarks: 12,
  },
  questions: [
    new QuestionNode({
      number: 1,
      label: "Question 1 — Feedback Control Loop",
      type: QuestionType.MCQ,
      marks: 4,
      stem: [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "Consider the negative feedback control system shown in the block diagram below:" }),
          ],
        }),
        new ContentNode({
          type: ContentType.SVG,
          value: `<svg width="400" height="100" viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="25" width="60" height="50" fill="#e9ecef" stroke="#495057" stroke-width="1.5" rx="4"/>
  <text x="40" y="55" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#212529">R(s)</text>
  <line x1="70" y1="50" x2="120" y2="50" stroke="#212529" stroke-width="1.5" marker-end="url(#arrow)"/>
  <circle cx="130" cy="50" r="10" fill="#ffffff" stroke="#212529" stroke-width="1.5"/>
  <text x="130" y="54" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#212529">∑</text>
  <line x1="140" y1="50" x2="190" y2="50" stroke="#212529" stroke-width="1.5"/>
  <rect x="190" y="25" width="80" height="50" fill="#cfe2ff" stroke="#084298" stroke-width="1.5" rx="4"/>
  <text x="230" y="55" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#084298">G(s)</text>
  <line x1="270" y1="50" x2="340" y2="50" stroke="#212529" stroke-width="1.5"/>
  <text x="360" y="55" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#212529">Y(s)</text>
</svg>`,
        }),
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "The closed-loop transfer function is given by:" }),
          ],
        }),
        new ContentNode({
          type: ContentType.MATH,
          attributes: { format: MathFormat.TEX, mathType: MathType.DISPLAY },
          value: "T(s) = \\frac{Y(s)}{R(s)} = \\frac{G(s)}{1 + G(s) H(s)}",
        }),
      ],
      options: [
        new OptionNode({
          index: 0,
          letter: "A",
          content: [new ContentNode({ type: ContentType.TEXT, value: "The system is unconditionally stable for any open-loop gain K > 0." })],
        }),
        new OptionNode({
          index: 1,
          letter: "B",
          content: [new ContentNode({ type: ContentType.TEXT, value: "The phase margin determines damping ratio and peak overshoot." })],
        }),
      ],
    }),
    new QuestionNode({
      number: 2,
      label: "Question 2 — Discrete Fourier Transform",
      type: QuestionType.NUMERICAL,
      marks: 4,
      stem: [
        new ContentNode({
          type: ContentType.PARAGRAPH,
          children: [
            new ContentNode({ type: ContentType.TEXT, value: "Given an N-point signal, compute the computational complexity of the Fast Fourier Transform (FFT):" }),
          ],
        }),
        new ContentNode({
          type: ContentType.MATH,
          attributes: { format: MathFormat.TEX, mathType: MathType.DISPLAY },
          value: "X[k] = \\sum_{n=0}^{N-1} x[n] \\cdot e^{-j \\frac{2\\pi}{N} k n}",
        }),
      ],
    }),
  ],
});

const samples = [
  { name: "sample-1-simple", doc: docSimple },
  { name: "sample-2-math", doc: docMath },
  { name: "sample-3-code", doc: docCode },
  { name: "sample-4-table", doc: docTable },
  { name: "sample-5-mixed", doc: docMixed },
];

console.log("Generating visual PDF samples...");

for (const s of samples) {
  const html = renderPdfDocument(s.doc);
  const htmlPath = join(OUT_DIR, `${s.name}.html`);
  const pdfPath = join(OUT_DIR, `${s.name}.pdf`);
  const pngPath = join(OUT_DIR, `${s.name}.png`);

  writeFileSync(htmlPath, html, "utf8");
  console.log(`✓ Wrote HTML: ${htmlPath}`);

  // Headless Chrome PDF generation
  try {
    const chromeCmd = `"${CHROME_PATH}" --headless --disable-gpu --print-to-pdf="${pdfPath}" "${htmlPath}"`;
    execSync(chromeCmd, { stdio: "ignore" });
    console.log(`✓ Rendered PDF: ${pdfPath}`);

    // macOS sips PDF to PNG rasterization
    const sipsCmd = `sips -s format png "${pdfPath}" --out "${pngPath}"`;
    execSync(sipsCmd, { stdio: "ignore" });
    console.log(`✓ Converted PNG: ${pngPath}`);
  } catch (err) {
    console.error(`⚠️ Failed to render PDF or PNG for ${s.name}: ${err.message}`);
  }
}

console.log("\nAll sample PDFs and PNGs generated successfully in " + OUT_DIR);
