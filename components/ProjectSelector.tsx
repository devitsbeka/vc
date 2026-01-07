import React, { useState } from 'react';
import { isWebMode, getDialogOpen } from '../services/webCompat';

interface ProjectSelectorProps {
  onProjectSelect: (path: string) => void;
}

const ProjectSelector: React.FC<ProjectSelectorProps> = ({ onProjectSelect }) => {
  const [isSelecting, setIsSelecting] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [showWebInput, setShowWebInput] = useState(false);

  const handleSelectDirectory = async () => {
    setIsSelecting(true);
    try {
      const open = await getDialogOpen();
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Project Directory'
      });

      if (selected && typeof selected === 'string') {
        onProjectSelect(selected);
      } else if (isWebMode()) {
        // In web mode, if no folder was selected, show input
        setShowWebInput(true);
      }
    } catch (error) {
      console.error('Error selecting directory:', error);
      if (isWebMode()) {
        // In web mode, fall back to text input
        setShowWebInput(true);
      } else {
        alert('Failed to select directory. Please try again.');
      }
    } finally {
      setIsSelecting(false);
    }
  };

  const handleWebProjectSubmit = () => {
    const name = projectName.trim() || 'my-project';
    // In web mode, we use a virtual project path
    onProjectSelect(`/web-projects/${name}`);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-ide-bg">
      <div className="max-w-md w-full mx-4">
        <div className="bg-ide-panel rounded-lg border border-ide-border p-8 shadow-lg">
          {/* Logo/Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-ide-accent/20 rounded-lg flex items-center justify-center">
              <svg className="w-12 h-12 text-ide-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-ide-text text-center mb-2">
            VoltCode
          </h1>
          <p className="text-ide-textLight text-center mb-8">
            AI-powered IDE for web development
          </p>

          {/* Description */}
          <div className="bg-ide-bg rounded-md p-4 mb-6">
            <p className="text-sm text-ide-textLight mb-2">
              {isWebMode() 
                ? 'Enter a project name to get started with AI-powered code generation.'
                : 'To get started, select a project directory where all generated files will be saved.'}
            </p>
            {!isWebMode() && (
              <ul className="text-xs text-ide-textLight space-y-1 list-disc list-inside">
                <li>Choose an empty directory for a new project</li>
                <li>Or select an existing project to continue</li>
                <li>All CLI-generated files will be stored here</li>
              </ul>
            )}
            {isWebMode() && (
              <p className="text-xs text-ide-textLight mt-2">
                🌐 Running in web mode - AI features available, file system limited
              </p>
            )}
          </div>

          {/* Web Mode Project Input */}
          {(isWebMode() || showWebInput) && (
            <div className="mb-4">
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter project name..."
                className="w-full bg-ide-bg border border-ide-border rounded-md px-4 py-2 text-ide-text placeholder-ide-textLight focus:outline-none focus:ring-2 focus:ring-ide-accent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleWebProjectSubmit();
                  }
                }}
              />
              <button
                onClick={handleWebProjectSubmit}
                className="w-full mt-2 bg-ide-accent hover:bg-ide-accent/90 text-white font-medium py-3 px-4 rounded-md transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Create Project
              </button>
            </div>
          )}

          {/* Open Button (non-web mode) */}
          {!isWebMode() && !showWebInput && (
            <button
              onClick={handleSelectDirectory}
              disabled={isSelecting}
              className="w-full bg-ide-accent hover:bg-ide-accent/90 text-white font-medium py-3 px-4 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSelecting ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Selecting...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                  </svg>
                  Open Project
                </>
              )}
            </button>
          )}

          {/* Recent Projects (placeholder for future) */}
          <div className="mt-6 pt-6 border-t border-ide-border">
            <p className="text-xs text-ide-textLight text-center">
              Recent projects will appear here
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center">
          <p className="text-xs text-ide-textLight">
            Powered by Claude Code, Gemini, Codex, and Kiro
          </p>
        </div>
      </div>
    </div>
  );
};

export default ProjectSelector;
